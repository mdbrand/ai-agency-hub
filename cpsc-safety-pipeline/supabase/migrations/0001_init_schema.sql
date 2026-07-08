-- CPSC Product-Safety Intelligence Pipeline — initial schema
-- See ../../docs/BUILD_SPEC.md Section 3 for field definitions.

create table if not exists recalls (
  recall_id             text primary key,
  recall_date           date,
  title                 text,
  url                   text,
  hazard_text           text,
  hazard_category       text,
  standard_violated     text,
  product_category      text,
  units_affected        integer,
  injury_count          integer,
  death_count           integer default 0,
  injury_narrative      text,
  remedy_type           text,
  manufacturer          text,
  importer              text,
  retailer_channel      text,
  country_of_manufacture text,
  raw_json              jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists idx_recalls_product_category on recalls (product_category);
create index if not exists idx_recalls_hazard_category on recalls (hazard_category);
create index if not exists idx_recalls_standard_violated on recalls (standard_violated);
create index if not exists idx_recalls_manufacturer on recalls (manufacturer);
create index if not exists idx_recalls_death_count on recalls (death_count) where death_count > 0;

create table if not exists standards_calendar (
  id                        uuid primary key default gen_random_uuid(),
  event_date                date,
  committee                 text,
  topic                     text,
  meeting_type              text,
  source_url                text,
  related_product_category  text,
  created_at                timestamptz not null default now()
);

create index if not exists idx_standards_calendar_category on standards_calendar (related_product_category);
create index if not exists idx_standards_calendar_event_date on standards_calendar (event_date);

create table if not exists entities (
  entity_name     text primary key,
  aliases         text[] not null default '{}',
  first_seen_date date,
  recall_count    integer not null default 0,
  categories      text[] not null default '{}',
  created_at      timestamptz not null default now()
);

create table if not exists incident_reports (
  report_id         text primary key,
  report_date       date,
  product_category  text,
  hazard_description text,
  manufacturer_named text,
  became_recall     boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists idx_incident_reports_category on incident_reports (product_category);
create index if not exists idx_incident_reports_manufacturer on incident_reports (manufacturer_named);
