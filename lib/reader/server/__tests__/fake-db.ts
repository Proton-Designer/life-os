// In-memory stand-in for the slice of supabase-js the reader cores use: table select/insert/update/delete/
// upsert with eq/in/lt/gte filters, order/limit, maybeSingle/single, rpc handlers, and a Storage bucket.
// RLS is deliberately NOT modelled: a row owned by another user is visible to every query, so a test that
// signs in as user A and touches user B's row only passes when the core filters on user_id explicitly.

type Row = Record<string, unknown>;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  objects = new Map<string, Uint8Array>();
  rpcCalls: { fn: string; args: Row }[] = [];
  rpcHandlers: Record<string, (args: Row) => { data: unknown; error: { message: string } | null }> = {};
  seq = 0;
  /** Filters seen on every query: lets a test assert the explicit user_id guard. */
  filtersSeen: { table: string; col: string; op: string }[] = [];

  seed(table: string, rows: Row[]) {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows];
  }

  from(table: string) {
    return new Query(this, table);
  }

  rpc(fn: string, args: Row) {
    this.rpcCalls.push({ fn, args });
    const h = this.rpcHandlers[fn];
    return Promise.resolve(h ? h(args) : { data: null, error: { message: `no handler for ${fn}` } });
  }

  storage = {
    from: (_bucket: string) => ({
      list: async (folder: string) => {
        const names = [...this.objects.keys()].filter((k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes("/")).map((k) => ({ name: k.slice(folder.length + 1) }));
        return { data: names, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) this.objects.delete(p);
        return { data: null, error: null };
      },
      upload: async (path: string, body: Blob) => {
        this.objects.set(path, new Uint8Array(await body.arrayBuffer()));
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const bytes = this.objects.get(path);
        if (!bytes) return { data: null, error: { message: "not found" } };
        return { data: new Blob([bytes as BlobPart]), error: null };
      },
      createSignedUploadUrl: async (path: string) => ({ data: { path, token: `tok-${path}`, signedUrl: `https://x/${path}` }, error: null }),
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
    }),
  };

  put(path: string, bytes: Uint8Array | string) {
    this.objects.set(path, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
  }
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | undefined;
  private orderBy: { col: string; asc: boolean }[] = [];
  private max = Infinity;
  private wantRows = false;
  private onConflict: string | undefined;
  private rangeFrom = 0;

  constructor(private db: FakeDb, private table: string) {}

  private f(col: string, op: string, fn: Filter) {
    this.db.filtersSeen.push({ table: this.table, col, op });
    this.filters.push(fn);
    return this;
  }
  select(_cols?: string) {
    this.wantRows = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  upsert(row: Row, o?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = o?.onConflict;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    return this.f(col, "eq", (r) => r[col] === v);
  }
  in(col: string, vs: unknown[]) {
    return this.f(col, "in", (r) => vs.includes(r[col]));
  }
  lt(col: string, v: string) {
    return this.f(col, "lt", (r) => String(r[col]) < v);
  }
  gte(col: string, v: string) {
    return this.f(col, "gte", (r) => String(r[col]) >= v);
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.max = to - from + 1;
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: o?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    return this.run(true, false);
  }
  single() {
    return this.run(true, true);
  }
  then<T1, T2>(ok?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
    return this.run(false, false).then(ok, bad);
  }

  private async run(one: boolean, strict: boolean): Promise<{ data: unknown; error: unknown }> {
    const rows = (this.db.tables[this.table] ??= []);
    const match = (r: Row) => this.filters.every((fn) => fn(r));
    let out: Row[];
    if (this.op === "insert") {
      const row = { id: crypto.randomUUID(), created_at: new Date(1_700_000_000_000 + ++this.db.seq * 1000).toISOString(), ...this.payload };
      rows.push(row);
      out = [row];
    } else if (this.op === "upsert") {
      const key = this.onConflict ?? "id";
      const existing = rows.find((r) => r[key] === this.payload?.[key]);
      if (existing) Object.assign(existing, this.payload);
      else rows.push({ ...this.payload });
      out = [existing ?? rows[rows.length - 1]];
    } else if (this.op === "update") {
      out = rows.filter(match);
      for (const r of out) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      out = rows.filter(match);
      this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
    } else {
      out = rows.filter(match);
    }
    for (const { col, asc } of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    out = out.slice(this.rangeFrom, this.rangeFrom + this.max);
    if (one) {
      // PostgREST: maybeSingle() with 2+ rows is an error too (only 0 rows is allowed to be null).
      if (out.length > 1) return { data: null, error: { message: "multiple rows returned" } };
      if (strict && out.length !== 1) return { data: null, error: { message: "expected one row" } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: this.wantRows || this.op === "select" ? out : null, error: null };
  }
}
