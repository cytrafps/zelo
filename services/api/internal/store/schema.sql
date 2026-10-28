-- Schéma idempotent : rejoué à chaque démarrage.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS fuel_station (
    id          text PRIMARY KEY,
    geom        geography(Point, 4326) NOT NULL,
    address     text NOT NULL DEFAULT '',
    city        text NOT NULL DEFAULT '',
    postcode    text NOT NULL DEFAULT '',
    seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fuel_station_geom ON fuel_station USING gist (geom);

CREATE TABLE IF NOT EXISTS fuel_price (
    station_id  text NOT NULL REFERENCES fuel_station (id) ON DELETE CASCADE,
    fuel        text NOT NULL,
    price       numeric(6, 3) NOT NULL,
    updated_at  timestamptz NOT NULL,
    PRIMARY KEY (station_id, fuel)
);

CREATE TABLE IF NOT EXISTS charge_point (
    id            text PRIMARY KEY,
    station_id    text NOT NULL,
    station_name  text NOT NULL DEFAULT '',
    operator      text NOT NULL DEFAULT '',
    address       text NOT NULL DEFAULT '',
    geom          geography(Point, 4326) NOT NULL,
    power_kw      real NOT NULL DEFAULT 0,
    sockets       text[] NOT NULL DEFAULT '{}',
    free          boolean NOT NULL DEFAULT false,
    card_payment  boolean NOT NULL DEFAULT false,
    hours         text NOT NULL DEFAULT '',
    seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_point_geom ON charge_point USING gist (geom);
CREATE INDEX IF NOT EXISTS charge_point_station ON charge_point (station_id);

-- Pas de clé étrangère : le flux dynamique contient des points absents du statique.
CREATE TABLE IF NOT EXISTS charge_status (
    id           text PRIMARY KEY,
    state        text NOT NULL,
    occupancy    text NOT NULL,
    observed_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,
    geom        geography(Point, 4326) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS report_geom ON report USING gist (geom);
CREATE INDEX IF NOT EXISTS report_expires ON report (expires_at);

CREATE TABLE IF NOT EXISTS parking (
    id             text PRIMARY KEY,
    name           text NOT NULL DEFAULT '',
    operator       text NOT NULL DEFAULT '',
    kind           text NOT NULL,
    geom           geography(Point, 4326) NOT NULL,
    capacity       integer,
    disabled       integer,
    charging       integer,
    fee            boolean,
    max_height     real,
    opening_hours  text NOT NULL DEFAULT '',
    park_ride      boolean NOT NULL DEFAULT false,
    seen_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_geom ON parking USING gist (geom);

-- Fiabilité des signalements : votes « toujours là / plus là » (un par appareil et par signalement).
ALTER TABLE report ADD COLUMN IF NOT EXISTS reporter text NOT NULL DEFAULT '';
ALTER TABLE report ADD COLUMN IF NOT EXISTS confirmations integer NOT NULL DEFAULT 0;
ALTER TABLE report ADD COLUMN IF NOT EXISTS denials integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS report_vote (
    report_id  bigint NOT NULL REFERENCES report (id) ON DELETE CASCADE,
    voter      text NOT NULL,
    up         boolean NOT NULL,
    voted_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, voter)
);

-- Prix au kWh annoncé dans le champ libre « tarification » (null : non publié lisiblement).
ALTER TABLE charge_point ADD COLUMN IF NOT EXISTS price_kwh real;
ALTER TABLE charge_point ADD COLUMN IF NOT EXISTS price_from boolean NOT NULL DEFAULT false;

-- Feux tricolores et stops (OSM), repères du guidage : « au feu, tournez à droite ».
CREATE TABLE IF NOT EXISTS junction_control (
    id    text PRIMARY KEY,
    kind  text NOT NULL,
    geom  geography(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS junction_control_geom ON junction_control USING gist (geom);

-- Aires d'autoroute et de repos (OSM) : contour, centre et services (restauration, douches…).
CREATE TABLE IF NOT EXISTS service_area (
    id        text PRIMARY KEY,
    kind      text NOT NULL,
    name      text NOT NULL DEFAULT '',
    operator  text NOT NULL DEFAULT '',
    geom      geography(Polygon, 4326) NOT NULL,
    center    geography(Point, 4326) NOT NULL,
    services  text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS service_area_geom ON service_area USING gist (geom);
