PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    homepage_url TEXT,
    license_name TEXT,
    license_url TEXT,
    terms_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_runs (
    id TEXT PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    source_version TEXT,
    source_uri TEXT,
    input_digest TEXT,
    importer_version TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    rows_read INTEGER NOT NULL DEFAULT 0,
    rows_written INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_catalog_runs_source_started
ON catalog_runs(source_id, started_at);

CREATE TABLE IF NOT EXISTS part_categories (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS colors (
    id INTEGER PRIMARY KEY,
    canonical_ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    rgb_hex TEXT,
    is_transparent INTEGER NOT NULL DEFAULT 0 CHECK (is_transparent IN (0, 1)),
    is_metallic INTEGER NOT NULL DEFAULT 0 CHECK (is_metallic IN (0, 1)),
    material TEXT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS part_designs (
    id INTEGER PRIMARY KEY,
    canonical_ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id INTEGER REFERENCES part_categories(id),
    material TEXT,
    first_year INTEGER,
    last_year INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_part_designs_category ON part_designs(category_id);
CREATE INDEX IF NOT EXISTS idx_part_designs_name ON part_designs(name);

CREATE TABLE IF NOT EXISTS elements (
    id INTEGER PRIMARY KEY,
    canonical_ref TEXT NOT NULL UNIQUE,
    design_id INTEGER NOT NULL REFERENCES part_designs(id),
    color_id INTEGER NOT NULL REFERENCES colors(id),
    material TEXT,
    decoration TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elements_design_color ON elements(design_id, color_id);

CREATE TABLE IF NOT EXISTS geometry_metadata (
    id INTEGER PRIMARY KEY,
    design_id INTEGER NOT NULL REFERENCES part_designs(id),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    ldraw_ref TEXT,
    width_studs REAL,
    depth_studs REAL,
    height_plates REAL,
    length_mm REAL,
    width_mm REAL,
    height_mm REAL,
    mass_grams REAL,
    geometry_status TEXT NOT NULL DEFAULT 'unverified',
    connection_points_json TEXT NOT NULL DEFAULT '[]',
    mesh_uri TEXT,
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(design_id, source_id)
);

CREATE TABLE IF NOT EXISTS part_relationships (
    id INTEGER PRIMARY KEY,
    from_design_id INTEGER NOT NULL REFERENCES part_designs(id),
    to_design_id INTEGER NOT NULL REFERENCES part_designs(id),
    relationship_type TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    notes TEXT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(from_design_id, to_design_id, relationship_type, source_id)
);

CREATE TABLE IF NOT EXISTS catalog_sets (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    set_ref TEXT NOT NULL,
    name TEXT,
    year INTEGER,
    theme_id TEXT,
    part_count INTEGER,
    set_url TEXT,
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, set_ref)
);

CREATE TABLE IF NOT EXISTS set_appearances (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    inventory_ref TEXT NOT NULL,
    set_id INTEGER REFERENCES catalog_sets(id),
    design_id INTEGER NOT NULL REFERENCES part_designs(id),
    color_id INTEGER REFERENCES colors(id),
    quantity INTEGER NOT NULL DEFAULT 0,
    is_spare INTEGER NOT NULL DEFAULT 0 CHECK (is_spare IN (0, 1)),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, inventory_ref, design_id, color_id, is_spare)
);

CREATE INDEX IF NOT EXISTS idx_set_appearances_design ON set_appearances(design_id);

CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    canonical_ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL,
    city TEXT,
    address_line TEXT,
    postal_code TEXT,
    latitude REAL,
    longitude REAL,
    website_url TEXT,
    has_pick_a_brick INTEGER NOT NULL DEFAULT 0 CHECK (has_pick_a_brick IN (0, 1)),
    source_id INTEGER NOT NULL REFERENCES sources(id),
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stores_country_city ON stores(country_code, city);

CREATE TABLE IF NOT EXISTS offer_snapshots (
    id INTEGER PRIMARY KEY,
    snapshot_ref TEXT NOT NULL,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    country_code TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    UNIQUE(source_id, snapshot_ref)
);

CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES offer_snapshots(id),
    element_id INTEGER NOT NULL REFERENCES elements(id),
    store_id INTEGER REFERENCES stores(id),
    external_offer_ref TEXT NOT NULL,
    item_condition TEXT NOT NULL DEFAULT 'new',
    unit_price REAL,
    quantity_available INTEGER,
    availability TEXT NOT NULL DEFAULT 'unknown',
    product_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(snapshot_id, external_offer_ref)
);

CREATE INDEX IF NOT EXISTS idx_offers_element ON offers(element_id);

CREATE TABLE IF NOT EXISTS wall_sightings (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),
    element_id INTEGER NOT NULL REFERENCES elements(id),
    observed_at TEXT NOT NULL,
    expires_at TEXT,
    quantity_status TEXT NOT NULL DEFAULT 'seen',
    confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    reporter_ref TEXT,
    notes TEXT,
    last_run_id TEXT REFERENCES catalog_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, store_id, element_id, observed_at, reporter_ref)
);

CREATE INDEX IF NOT EXISTS idx_wall_sightings_store_observed
ON wall_sightings(store_id, observed_at);

CREATE TABLE IF NOT EXISTS external_identifiers (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    namespace TEXT NOT NULL,
    external_id TEXT NOT NULL,
    design_id INTEGER REFERENCES part_designs(id),
    color_id INTEGER REFERENCES colors(id),
    element_id INTEGER REFERENCES elements(id),
    store_id INTEGER REFERENCES stores(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        (CASE WHEN design_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN color_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN element_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN store_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    ),
    UNIQUE(source_id, namespace, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_ids_design ON external_identifiers(design_id);
CREATE INDEX IF NOT EXISTS idx_external_ids_element ON external_identifiers(element_id);

CREATE TABLE IF NOT EXISTS record_versions (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    run_id TEXT NOT NULL REFERENCES catalog_runs(id),
    version_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_versions_current
ON record_versions(entity_type, entity_id, source_id, is_current);

CREATE TABLE IF NOT EXISTS record_provenance (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    run_id TEXT NOT NULL REFERENCES catalog_runs(id),
    source_file TEXT,
    source_row INTEGER,
    operation TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    raw_json TEXT,
    UNIQUE(entity_type, entity_id, run_id)
);

CREATE TABLE IF NOT EXISTS rarity_scores (
    id INTEGER PRIMARY KEY,
    design_id INTEGER REFERENCES part_designs(id),
    element_id INTEGER REFERENCES elements(id),
    score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
    band TEXT NOT NULL CHECK (band IN ('common', 'uncommon', 'rare', 'very_rare')),
    distinct_set_count INTEGER NOT NULL DEFAULT 0,
    total_set_quantity INTEGER NOT NULL DEFAULT 0,
    active_offer_count INTEGER NOT NULL DEFAULT 0,
    active_offer_quantity INTEGER NOT NULL DEFAULT 0,
    algorithm_version TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    run_id TEXT REFERENCES catalog_runs(id),
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    CHECK (
        (CASE WHEN design_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN element_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_rarity_design_current
ON rarity_scores(design_id, is_current);
CREATE INDEX IF NOT EXISTS idx_rarity_element_current
ON rarity_scores(element_id, is_current);
