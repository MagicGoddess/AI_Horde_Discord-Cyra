import { existsSync, mkdirSync } from "fs";
import path from "path";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { Config, CreatePartyInput, DatabaseAdapter, DatabaseCounts, Party, PendingKudosRecord, UpdatePartyInput, UserTokenRecord } from "./types";

type RawPartyRow = {
    index: number,
    channel_id: string,
    guild_id: string,
    creator_id: string,
    created_at: string | Date,
    ends_at: string | Date,
    style: string,
    width: number | null,
    height: number | null,
    award: number,
    recurring: boolean | number,
    advanced_generate_allowed?: boolean | number | null,
    users: string[] | string | null,
    shared_key: string | null,
    wordlist: string[] | string | null
}

type RawPendingKudosRow = {
    index: number,
    unique_id: string,
    target_id: string,
    from_id: string,
    amount: number,
    updated_at: string | Date
}

function normalizeParty(row: RawPartyRow | undefined): Party | undefined {
    if(!row) return undefined;
    return {
        index: Number(row.index || 0),
        channel_id: row.channel_id,
        guild_id: row.guild_id,
        creator_id: row.creator_id,
        created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        ends_at: row.ends_at instanceof Date ? row.ends_at : new Date(row.ends_at),
        style: row.style,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        award: row.award,
        recurring: typeof row.recurring === "boolean" ? row.recurring : !!row.recurring,
        advanced_generate_allowed: typeof row.advanced_generate_allowed === "boolean" ? row.advanced_generate_allowed : !!row.advanced_generate_allowed,
        users: Array.isArray(row.users) ? row.users : parseStringArray(row.users),
        shared_key: row.shared_key ?? undefined,
        wordlist: Array.isArray(row.wordlist) ? row.wordlist : parseStringArray(row.wordlist)
    };
}

function normalizePendingKudos(row: RawPendingKudosRow): PendingKudosRecord {
    return {
        ...row,
        index: Number(row.index || 0),
        updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
    };
}

function parseStringArray(value: string | null | undefined): string[] {
    if(!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function ensureSqliteDirectory(dbPath: string) {
    const resolved = path.resolve(dbPath);
    const directory = path.dirname(resolved);
    if(!existsSync(directory)) mkdirSync(directory, {recursive: true});
    return resolved;
}

class PostgresAdapter implements DatabaseAdapter {
    constructor(private readonly pool: Pool) {}

    async initialize(): Promise<void> {
        await this.pool.query("CREATE TABLE IF NOT EXISTS user_tokens (index SERIAL, id VARCHAR(100) PRIMARY KEY, token VARCHAR(100) NOT NULL, horde_id int NOT NULL DEFAULT 0)");
        await this.pool.query("CREATE TABLE IF NOT EXISTS parties (index SERIAL, channel_id VARCHAR(100) PRIMARY KEY, guild_id VARCHAR(100) NOT NULL, creator_id VARCHAR(100) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ends_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, style VARCHAR(1000) NOT NULL, width INT, height INT, award INT NOT NULL DEFAULT 1, recurring BOOLEAN NOT NULL DEFAULT false, advanced_generate_allowed BOOLEAN NOT NULL DEFAULT false, users VARCHAR(100)[] NOT NULL DEFAULT '{}', shared_key VARCHAR(100), wordlist text[] NOT NULL DEFAULT '{}')");
        await this.pool.query("ALTER TABLE parties ADD COLUMN IF NOT EXISTS width INT");
        await this.pool.query("ALTER TABLE parties ADD COLUMN IF NOT EXISTS height INT");
        await this.pool.query("ALTER TABLE parties ADD COLUMN IF NOT EXISTS advanced_generate_allowed BOOLEAN NOT NULL DEFAULT false");
        await this.pool.query("CREATE TABLE IF NOT EXISTS pending_kudos (index SERIAL, unique_id VARCHAR(200) PRIMARY KEY, target_id VARCHAR(100) NOT NULL, from_id VARCHAR(100) NOT NULL, amount int NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    }

    async getUserToken(user_id: string): Promise<UserTokenRecord | undefined> {
        const result = await this.pool.query<UserTokenRecord>("SELECT * FROM user_tokens WHERE id=$1", [user_id]);
        return result.rows[0];
    }

    async upsertUserToken(user_id: string, token: string, horde_id: number): Promise<UserTokenRecord | undefined> {
        const result = await this.pool.query<UserTokenRecord>("INSERT INTO user_tokens VALUES (DEFAULT, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET token=$2, horde_id=$3 RETURNING *", [user_id, token, horde_id]);
        return result.rows[0];
    }

    async deleteUserToken(user_id: string): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM user_tokens WHERE id=$1", [user_id]);
        return (result.rowCount || 0) > 0;
    }

    async getUserTokenByHordeId(horde_id: number): Promise<UserTokenRecord | undefined> {
        const result = await this.pool.query<UserTokenRecord>("SELECT * FROM user_tokens WHERE horde_id=$1 LIMIT 1", [horde_id]);
        return result.rows[0];
    }

    async getParty(channel_id: string): Promise<Party | undefined> {
        const result = await this.pool.query<RawPartyRow>("SELECT * FROM parties WHERE channel_id=$1", [channel_id]);
        return normalizeParty(result.rows[0]);
    }

    async createParty(input: CreatePartyInput): Promise<Party | undefined> {
        const result = await this.pool.query<RawPartyRow>(
            "INSERT INTO parties (channel_id, guild_id, creator_id, ends_at, style, width, height, award, recurring, advanced_generate_allowed, shared_key, wordlist) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *",
            [input.channel_id, input.guild_id, input.creator_id, input.ends_at, input.style, input.width, input.height, input.award, input.recurring, input.advanced_generate_allowed, input.shared_key, input.wordlist]
        );
        return normalizeParty(result.rows[0]);
    }

    async updateParty(channel_id: string, updates: UpdatePartyInput): Promise<Party | undefined> {
        const sets: string[] = [];
        const values: Array<Date | string | number | boolean | null> = [channel_id];
        let index = 2;
        if("ends_at" in updates) {
            sets.push(`ends_at=$${index++}`);
            values.push(updates.ends_at || null);
        }
        if("style" in updates) {
            sets.push(`style=$${index++}`);
            values.push(updates.style || null);
        }
        if("width" in updates) {
            sets.push(`width=$${index++}`);
            values.push(updates.width ?? null);
        }
        if("height" in updates) {
            sets.push(`height=$${index++}`);
            values.push(updates.height ?? null);
        }
        if("advanced_generate_allowed" in updates) {
            sets.push(`advanced_generate_allowed=$${index++}`);
            values.push(updates.advanced_generate_allowed ?? false);
        }
        if(!sets.length) return this.getParty(channel_id);
        const result = await this.pool.query<RawPartyRow>(`UPDATE parties SET ${sets.join(", ")} WHERE channel_id=$1 RETURNING *`, values);
        return normalizeParty(result.rows[0]);
    }

    async deleteParty(channel_id: string): Promise<Party | undefined> {
        const result = await this.pool.query<RawPartyRow>("DELETE FROM parties WHERE channel_id=$1 RETURNING *", [channel_id]);
        return normalizeParty(result.rows[0]);
    }

    async deleteExpiredParties(now: Date = new Date()): Promise<Party[]> {
        const result = await this.pool.query<RawPartyRow>("DELETE FROM parties WHERE ends_at <= $1 RETURNING *", [now]);
        return result.rows.map(row => normalizeParty(row)!).filter(Boolean);
    }

    async recordPartyParticipant(channel_id: string, user_id: string): Promise<Party | undefined> {
        const result = await this.pool.query<RawPartyRow>("UPDATE parties SET users=array_append(array_remove(users, $2), $2) WHERE channel_id=$1 RETURNING *", [channel_id, user_id]);
        return normalizeParty(result.rows[0]);
    }

    async upsertPendingKudos(unique_id: string, target_id: string, from_id: string, amount: number): Promise<PendingKudosRecord | undefined> {
        const result = await this.pool.query<RawPendingKudosRow>("INSERT INTO pending_kudos (unique_id, target_id, from_id, amount) VALUES ($1, $2, $3, $4) ON CONFLICT (unique_id) DO UPDATE SET amount = pending_kudos.amount + $4, updated_at = CURRENT_TIMESTAMP RETURNING *", [unique_id, target_id, from_id, amount]);
        return result.rows[0] ? normalizePendingKudos(result.rows[0]) : undefined;
    }

    async claimPendingKudos(target_id: string): Promise<PendingKudosRecord[]> {
        const result = await this.pool.query<RawPendingKudosRow>("DELETE FROM pending_kudos WHERE target_id=$1 RETURNING *", [target_id]);
        return result.rows.map(normalizePendingKudos);
    }

    async deleteExpiredPendingKudos(cutoff: Date): Promise<number> {
        const result = await this.pool.query("DELETE FROM pending_kudos WHERE updated_at <= $1", [cutoff]);
        return result.rowCount || 0;
    }

    async getCounts(): Promise<DatabaseCounts> {
        const result = await this.pool.query<DatabaseCounts>("SELECT (SELECT COUNT(*) FROM user_tokens) as user_tokens, (SELECT COUNT(*) FROM parties) as parties, (SELECT COUNT(*) FROM pending_kudos) as pending_kudos");
        return {
            user_tokens: Number(result.rows[0]?.user_tokens || 0),
            parties: Number(result.rows[0]?.parties || 0),
            pending_kudos: Number(result.rows[0]?.pending_kudos || 0)
        };
    }
}

class SqliteAdapter implements DatabaseAdapter {
    private readonly db: Database.Database;

    constructor(databasePath: string) {
        const resolvedPath = ensureSqliteDirectory(databasePath);
        this.db = new Database(resolvedPath);
    }

    async initialize(): Promise<void> {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_tokens (
                "index" INTEGER,
                id TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                horde_id INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS parties (
                "index" INTEGER,
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                creator_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ends_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                style TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                award INTEGER NOT NULL DEFAULT 1,
                recurring INTEGER NOT NULL DEFAULT 0,
                advanced_generate_allowed INTEGER NOT NULL DEFAULT 0,
                users TEXT NOT NULL DEFAULT '[]',
                shared_key TEXT,
                wordlist TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS pending_kudos (
                "index" INTEGER,
                unique_id TEXT PRIMARY KEY,
                target_id TEXT NOT NULL,
                from_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const partyColumns = this.db.prepare("PRAGMA table_info(parties)").all() as {name: string}[];
        if(!partyColumns.some(column => column.name === "advanced_generate_allowed")) {
            this.db.prepare("ALTER TABLE parties ADD COLUMN advanced_generate_allowed INTEGER NOT NULL DEFAULT 0").run();
        }
    }

    async getUserToken(user_id: string): Promise<UserTokenRecord | undefined> {
        const row = this.db.prepare("SELECT * FROM user_tokens WHERE id = ?").get(user_id) as UserTokenRecord | undefined;
        return row;
    }

    async upsertUserToken(user_id: string, token: string, horde_id: number): Promise<UserTokenRecord | undefined> {
        this.db.prepare(`
            INSERT INTO user_tokens (id, token, horde_id)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET token = excluded.token, horde_id = excluded.horde_id
        `).run(user_id, token, horde_id);
        return this.getUserToken(user_id);
    }

    async deleteUserToken(user_id: string): Promise<boolean> {
        const result = this.db.prepare("DELETE FROM user_tokens WHERE id = ?").run(user_id);
        return result.changes > 0;
    }

    async getUserTokenByHordeId(horde_id: number): Promise<UserTokenRecord | undefined> {
        const row = this.db.prepare("SELECT * FROM user_tokens WHERE horde_id = ? LIMIT 1").get(horde_id) as UserTokenRecord | undefined;
        return row;
    }

    async getParty(channel_id: string): Promise<Party | undefined> {
        const row = this.db.prepare("SELECT * FROM parties WHERE channel_id = ?").get(channel_id) as RawPartyRow | undefined;
        return normalizeParty(row);
    }

    async createParty(input: CreatePartyInput): Promise<Party | undefined> {
        this.db.prepare(`
            INSERT INTO parties (channel_id, guild_id, creator_id, ends_at, style, width, height, award, recurring, advanced_generate_allowed, users, shared_key, wordlist)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.channel_id,
            input.guild_id,
            input.creator_id,
            input.ends_at.toISOString(),
            input.style,
            input.width,
            input.height,
            input.award,
            input.recurring ? 1 : 0,
            input.advanced_generate_allowed ? 1 : 0,
            JSON.stringify([]),
            input.shared_key,
            JSON.stringify(input.wordlist)
        );
        return this.getParty(input.channel_id);
    }

    async updateParty(channel_id: string, updates: UpdatePartyInput): Promise<Party | undefined> {
        const sets: string[] = [];
        const values: Array<Date | string | number | null> = [];
        if("ends_at" in updates) {
            sets.push("ends_at = ?");
            values.push(updates.ends_at ? updates.ends_at.toISOString() : null);
        }
        if("style" in updates) {
            sets.push("style = ?");
            values.push(updates.style || null);
        }
        if("width" in updates) {
            sets.push("width = ?");
            values.push(updates.width ?? null);
        }
        if("height" in updates) {
            sets.push("height = ?");
            values.push(updates.height ?? null);
        }
        if("advanced_generate_allowed" in updates) {
            sets.push("advanced_generate_allowed = ?");
            values.push(updates.advanced_generate_allowed ? 1 : 0);
        }
        if(!sets.length) return this.getParty(channel_id);
        this.db.prepare(`UPDATE parties SET ${sets.join(", ")} WHERE channel_id = ?`).run(...values, channel_id);
        return this.getParty(channel_id);
    }

    async deleteParty(channel_id: string): Promise<Party | undefined> {
        const existing = await this.getParty(channel_id);
        if(!existing) return undefined;
        this.db.prepare("DELETE FROM parties WHERE channel_id = ?").run(channel_id);
        return existing;
    }

    async deleteExpiredParties(now: Date = new Date()): Promise<Party[]> {
        const rows = this.db.prepare("SELECT * FROM parties WHERE ends_at <= ?").all(now.toISOString()) as RawPartyRow[];
        this.db.prepare("DELETE FROM parties WHERE ends_at <= ?").run(now.toISOString());
        return rows.map(row => normalizeParty(row)!).filter(Boolean);
    }

    async recordPartyParticipant(channel_id: string, user_id: string): Promise<Party | undefined> {
        const existing = await this.getParty(channel_id);
        if(!existing) return undefined;
        const users = [...existing.users.filter(user => user !== user_id), user_id];
        this.db.prepare("UPDATE parties SET users = ? WHERE channel_id = ?").run(JSON.stringify(users), channel_id);
        return this.getParty(channel_id);
    }

    async upsertPendingKudos(unique_id: string, target_id: string, from_id: string, amount: number): Promise<PendingKudosRecord | undefined> {
        const existing = this.db.prepare("SELECT * FROM pending_kudos WHERE unique_id = ?").get(unique_id) as RawPendingKudosRow | undefined;
        if(existing) {
            this.db.prepare("UPDATE pending_kudos SET amount = amount + ?, updated_at = ? WHERE unique_id = ?").run(amount, new Date().toISOString(), unique_id);
        } else {
            this.db.prepare("INSERT INTO pending_kudos (unique_id, target_id, from_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)").run(unique_id, target_id, from_id, amount, new Date().toISOString());
        }
        const row = this.db.prepare("SELECT * FROM pending_kudos WHERE unique_id = ?").get(unique_id) as RawPendingKudosRow | undefined;
        return row ? normalizePendingKudos(row) : undefined;
    }

    async claimPendingKudos(target_id: string): Promise<PendingKudosRecord[]> {
        const rows = this.db.prepare("SELECT * FROM pending_kudos WHERE target_id = ?").all(target_id) as RawPendingKudosRow[];
        this.db.prepare("DELETE FROM pending_kudos WHERE target_id = ?").run(target_id);
        return rows.map(normalizePendingKudos);
    }

    async deleteExpiredPendingKudos(cutoff: Date): Promise<number> {
        const result = this.db.prepare("DELETE FROM pending_kudos WHERE updated_at <= ?").run(cutoff.toISOString());
        return result.changes;
    }

    async getCounts(): Promise<DatabaseCounts> {
        const userTokens = this.db.prepare("SELECT COUNT(*) as count FROM user_tokens").get() as {count: number};
        const parties = this.db.prepare("SELECT COUNT(*) as count FROM parties").get() as {count: number};
        const pendingKudos = this.db.prepare("SELECT COUNT(*) as count FROM pending_kudos").get() as {count: number};
        return {
            user_tokens: userTokens.count,
            parties: parties.count,
            pending_kudos: pendingKudos.count
        };
    }
}

export function createDatabaseAdapter(config: Config): DatabaseAdapter {
    const type = config.database?.type || "postgres";
    if(type === "sqlite") {
        return new SqliteAdapter(config.database?.sqlite?.path || "./data/ai_horde.sqlite");
    }
    return new PostgresAdapter(new Pool({
        user: process.env["DB_USERNAME"],
        host: process.env["DB_IP"],
        database: process.env["DB_NAME"],
        password: process.env["DB_PASSWORD"],
        port: Number(process.env["DB_PORT"])
    }));
}
