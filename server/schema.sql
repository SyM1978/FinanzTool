-- =====================================================================
-- Meine Finanzen – Datenbankschema für PostgreSQL 15+ (Ubuntu 24.04: 16)
-- Smooth Solutions
--
-- Zwei Rollen:
--   finanzen_owner  besitzt die Tabellen, nur für Einrichtung/Migration
--   finanzen_app    die App; sieht dank Row-Level Security nur die Zeilen
--                   des angemeldeten Nutzers (SET app.user_id = '…')
--
-- Jede Fachtabelle hat eine Spalte extra (jsonb) für Felder, die die App
-- künftig ergänzt – so geht beim Abgleich nie etwas verloren.
--
-- Einspielen (als Superuser, einmalig):
--   psql -v app_password="'GEHEIM'" -f schema.sql finanzen
-- =====================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finanzen_owner') THEN CREATE ROLE finanzen_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finanzen_app') THEN CREATE ROLE finanzen_app LOGIN NOBYPASSRLS; END IF;
END $$;
ALTER ROLE finanzen_app WITH PASSWORD :app_password;

CREATE SCHEMA IF NOT EXISTS fin AUTHORIZATION finanzen_owner;
SET search_path = fin, public;
SET ROLE finanzen_owner;

-- aktueller Nutzer der Sitzung (gesetzt von der App pro Transaktion)
CREATE OR REPLACE FUNCTION fin.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------
-- Benutzer und Sitzungen
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name         text   NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  pw_hash      text   NOT NULL,
  is_admin     boolean NOT NULL DEFAULT false,
  alert_email  citext,                           -- abweichende Adresse für Kursalarme
  alert_mail   boolean NOT NULL DEFAULT false,   -- Kursalarme per E-Mail an/aus
  alert_last   timestamptz, alert_error text,    -- Zustand des Alarm-Dienstes
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_login   timestamptz,
  rev          bigint NOT NULL DEFAULT 0        -- Datenstand, steigt bei jeder Änderung
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   bytea PRIMARY KEY,               -- SHA-256 des Cookie-Werts, nie der Klartext
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- Finanzen: Konten, Daueraufträge, Buchungen, Finanzplan
-- Beträge in Cent (bigint), Datumswerte als date
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL CHECK (length(id) BETWEEN 1 AND 40),
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('giro','haushalt','spar','kredit','karte','sonst')),
  color        text,
  start_date   date NOT NULL,
  start_amount bigint NOT NULL DEFAULT 0,
  fee_amount   bigint, fee_interval char(1) CHECK (fee_interval IN ('m','q','j')), fee_day smallint CHECK (fee_day BETWEEN 1 AND 31),
  interest     numeric(6,3),
  goal_amount  bigint, goal_date date,
  min_amount   bigint NOT NULL DEFAULT 0,
  loan_rate    numeric(6,3), loan_day smallint, loan_pay_from text, loan_orig bigint, loan_order text,
  sort         integer NOT NULL DEFAULT 0,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,        -- Änderungszeit aus der App (ms), für Zusammenführen
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  name         text NOT NULL,
  amount       bigint NOT NULL CHECK (amount > 0),
  from_acc     text, to_acc text,                -- NULL = extern
  interval     char(1) NOT NULL CHECK (interval IN ('m','q','h','j')),
  day          smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  start_date   date NOT NULL,
  end_date     date,
  shift        text NOT NULL DEFAULT 'next' CHECK (shift IN ('next','prev','none')),
  cat          text,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)                      -- from_acc/to_acc: weiche Referenzen, die App räumt auf
);

CREATE TABLE IF NOT EXISTS bookings (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  acc          text NOT NULL,
  date         date NOT NULL,
  amount       bigint NOT NULL,
  text         text,
  cat          text,
  order_id     text, occ date,                   -- angepasste Ausführung eines Dauerauftrags
  tr           text,                             -- gemeinsame Kennung beider Seiten einer Umbuchung
  corr         boolean NOT NULL DEFAULT false,   -- Korrektur aus Bankabgleich
  sec_tx       text,                             -- automatisch aus dem Depot (Verrechnungskonto)
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, acc) REFERENCES accounts(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS bookings_acc_date ON bookings(user_id, acc, date);

CREATE TABLE IF NOT EXISTS order_skips (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id     text NOT NULL,
  occ          date NOT NULL,
  PRIMARY KEY (user_id, order_id, occ)
);

CREATE TABLE IF NOT EXISTS plan_groups (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  year         smallint NOT NULL CHECK (year BETWEEN 1990 AND 2200),
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('einnahme','fix','variabel')),
  sort         integer NOT NULL DEFAULT 0,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS plan_groups_year ON plan_groups(user_id, year);

CREATE TABLE IF NOT EXISTS plan_items (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  group_id     text NOT NULL,
  name         text NOT NULL,
  months       bigint[] NOT NULL CHECK (array_length(months, 1) = 12),
  sort         integer NOT NULL DEFAULT 0,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, group_id) REFERENCES plan_groups(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

-- ---------------------------------------------------------------------
-- Depot: Depots, Positionen, Wertpapier-Buchungen, Sparpläne, Watchlist,
-- Kursalarme, Termine. Stück und Kurse als numeric (Bruchstücke!)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS depots (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  name         text NOT NULL,
  cash_acc     text,                             -- Verrechnungskonto (accounts.id, weiche Referenz)
  sort         integer NOT NULL DEFAULT 0,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS positions (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  depot_id     text,
  name         text NOT NULL,
  sym          text NOT NULL,
  isin         text,
  kind         text CHECK (kind IS NULL OR kind IN ('aktie','aktien-etf','misch','sonst')),
  sector       text, country text,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)                      -- depot_id: weiche Referenz (leer = erstes Depot)
);

CREATE TABLE IF NOT EXISTS sec_tx (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  pos_id       text NOT NULL,
  type         text NOT NULL CHECK (type IN ('buy','sell','div')),
  date         date NOT NULL,
  qty          numeric(20,8) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  price        numeric(20,6) NOT NULL DEFAULT 0 CHECK (price >= 0),
  fee          numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  amount       numeric(14,2) NOT NULL DEFAULT 0,
  plan_id      text, occ date,                   -- aus einem Sparplan
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, pos_id) REFERENCES positions(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS sec_tx_pos ON sec_tx(user_id, pos_id, date);

CREATE TABLE IF NOT EXISTS savings_plans (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  pos_id       text NOT NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  fee          numeric(14,2) NOT NULL DEFAULT 0,
  interval     char(1) NOT NULL DEFAULT 'm' CHECK (interval IN ('m','q')),
  day          smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  start_date   date NOT NULL, end_date date,
  paused       boolean NOT NULL DEFAULT false,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, pos_id) REFERENCES positions(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  sym          text NOT NULL, name text NOT NULL, isin text, note text,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS price_alerts (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  sym          text NOT NULL, name text NOT NULL,
  type         text NOT NULL CHECK (type IN ('above','below','dayDown','dayUp')),
  value        numeric(20,6) NOT NULL CHECK (value > 0),
  hit_at       bigint NOT NULL DEFAULT 0, hit_day date,     -- Anzeige in der Seite
  mail_armed   boolean NOT NULL DEFAULT true,               -- Zustand des Mail-Versands
  mail_day     date, mail_sent_at timestamptz,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS events (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           text NOT NULL,
  date         date NOT NULL, title text NOT NULL, pos_ref text,
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  u            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- Zwischenspeicher für Kurse, Verläufe, Suche, News (keine Nutzerdaten)
CREATE TABLE IF NOT EXISTS market_cache (
  key          text PRIMARY KEY,
  data         jsonb NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Row-Level Security: jede Fachtabelle nur für den eigenen Nutzer.
-- Gilt für finanzen_app; der Besitzer (Einrichtung, SECURITY-DEFINER-
-- Funktionen unten) ist bewusst ausgenommen.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_settings','accounts','orders','bookings','order_skips','plan_groups','plan_items',
                           'depots','positions','sec_tx','savings_plans','watchlist','price_alerts','events']
  LOOP
    EXECUTE format('ALTER TABLE fin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON fin.%I', t);
    EXECUTE format('CREATE POLICY own_rows ON fin.%I USING (user_id = fin.uid()) WITH CHECK (user_id = fin.uid())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON fin.%I TO finanzen_app', t);
  END LOOP;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_user ON users;
CREATE POLICY own_user ON users USING (id = fin.uid()) WITH CHECK (id = fin.uid());
GRANT SELECT, UPDATE (name, pw_hash, alert_email, alert_mail, alert_last, alert_error, rev), DELETE ON users TO finanzen_app;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_sessions ON sessions;
CREATE POLICY own_sessions ON sessions USING (user_id = fin.uid()) WITH CHECK (user_id = fin.uid());
GRANT SELECT, DELETE ON sessions TO finanzen_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON market_cache TO finanzen_app;
GRANT USAGE ON SCHEMA fin TO finanzen_app;
GRANT EXECUTE ON FUNCTION fin.uid() TO finanzen_app;

-- ---------------------------------------------------------------------
-- Funktionen, die vor dem Login laufen müssen (SECURITY DEFINER,
-- laufen als Besitzer und umgehen RLS gezielt und eng begrenzt)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin.auth_lookup(p_email text)
RETURNS TABLE (id uuid, pw_hash text, name text) LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS
$$ SELECT u.id, u.pw_hash, u.name FROM fin.users u WHERE u.email = p_email::citext $$;

CREATE OR REPLACE FUNCTION fin.auth_register(p_email text, p_name text, p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, public AS $$
DECLARE v uuid; first boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM fin.users) INTO first;
  INSERT INTO fin.users(email, name, pw_hash, is_admin) VALUES (p_email, p_name, p_hash, first) RETURNING id INTO v;
  INSERT INTO fin.user_settings(user_id, data) VALUES (v, '{}'::jsonb);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fin.auth_user_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS
$$ SELECT count(*) FROM fin.users $$;

CREATE OR REPLACE FUNCTION fin.auth_session_create(p_hash bytea, p_user uuid, p_days int, p_ua text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  DELETE FROM fin.sessions WHERE expires_at < now();
  INSERT INTO fin.sessions(token_hash, user_id, expires_at, user_agent) VALUES (p_hash, p_user, now() + make_interval(days => p_days), left(p_ua, 200));
  UPDATE fin.users SET last_login = now() WHERE id = p_user;
$$;

CREATE OR REPLACE FUNCTION fin.auth_session_user(p_hash bytea)
RETURNS TABLE (user_id uuid, name text, email text, is_admin boolean) LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  SELECT u.id, u.name, u.email::text, u.is_admin FROM fin.sessions s JOIN fin.users u ON u.id = s.user_id
  WHERE s.token_hash = p_hash AND s.expires_at > now()
$$;

-- Für den Alarm-Dienst: welche Nutzer haben Kursalarme mit Mail?
CREATE OR REPLACE FUNCTION fin.alert_users()
RETURNS TABLE (user_id uuid, email text, name text) LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  SELECT DISTINCT u.id, coalesce(u.alert_email, u.email)::text, u.name FROM fin.users u JOIN fin.price_alerts a ON a.user_id = u.id
  WHERE u.alert_mail
$$;

REVOKE ALL ON FUNCTION fin.auth_lookup(text), fin.auth_register(text, text, text), fin.auth_user_count(),
  fin.auth_session_create(bytea, uuid, int, text), fin.auth_session_user(bytea), fin.alert_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin.auth_lookup(text), fin.auth_register(text, text, text), fin.auth_user_count(),
  fin.auth_session_create(bytea, uuid, int, text), fin.auth_session_user(bytea), fin.alert_users() TO finanzen_app;

-- ---------------------------------------------------------------------
-- Version 2: E-Mail-Bestätigung, Passwort zurücksetzen, Zwei-Faktor (TOTP)
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret    text;              -- Base32, erst aktiv mit totp_enabled
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled   boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint  NOT NULL DEFAULT 0;   -- gegen doppelt benutzte Codes
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes text[]  NOT NULL DEFAULT '{}'; -- SHA-256 der Notfall-Codes
GRANT UPDATE (totp_secret, totp_enabled, totp_last_step, recovery_codes) ON users TO finanzen_app;
-- Wer schon vor Version 2 ein Konto hatte, gilt als bestätigt
DO $$
DECLARE v text;
BEGIN
  IF to_regclass('fin.meta') IS NOT NULL THEN          -- bei frischer Datenbank gibt es meta noch nicht
    EXECUTE 'SELECT value FROM fin.meta WHERE key = ''schema_version''' INTO v;
    IF v = '1' THEN
      UPDATE fin.users SET email_verified = true WHERE NOT email_verified;
    END IF;
  END IF;
END $$;

-- Einmal-Links per Mail (nur der SHA-256 des Tokens wird gespeichert)
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash   bytea PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('verify','reset')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;   -- kein Zugriff für die App, nur über Funktionen

CREATE OR REPLACE FUNCTION fin.auth_lookup2(p_email text)
RETURNS TABLE (id uuid, pw_hash text, name text, email_verified boolean, totp_enabled boolean, totp_secret text,
               totp_last_step bigint, recovery_codes text[])
LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS
$$ SELECT u.id, u.pw_hash, u.name, u.email_verified, u.totp_enabled, u.totp_secret, u.totp_last_step, u.recovery_codes
   FROM fin.users u WHERE u.email = p_email::citext $$;

-- nach erfolgreicher Zwei-Faktor-Prüfung vor dem Login: Schritt merken bzw. Notfall-Code verbrauchen
CREATE OR REPLACE FUNCTION fin.auth_totp_used(p_user uuid, p_step bigint, p_recovery text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, public AS $$
BEGIN
  IF p_recovery IS NOT NULL THEN
    UPDATE fin.users SET recovery_codes = array_remove(recovery_codes, p_recovery)
     WHERE id = p_user AND p_recovery = ANY(recovery_codes);
    RETURN FOUND;
  END IF;
  UPDATE fin.users SET totp_last_step = p_step WHERE id = p_user AND totp_last_step < p_step;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION fin.auth_token_create(p_user uuid, p_kind text, p_hash bytea, p_minutes int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  DELETE FROM fin.auth_tokens WHERE expires_at < now() OR (user_id = p_user AND kind = p_kind);
  INSERT INTO fin.auth_tokens(token_hash, user_id, kind, expires_at) VALUES (p_hash, p_user, p_kind, now() + make_interval(mins => p_minutes));
$$;

-- prüft ein Token, ohne es zu verbrauchen
CREATE OR REPLACE FUNCTION fin.auth_token_user(p_hash bytea, p_kind text)
RETURNS TABLE (user_id uuid, email text, name text, totp_enabled boolean, totp_secret text, totp_last_step bigint, recovery_codes text[])
LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  SELECT u.id, u.email::text, u.name, u.totp_enabled, u.totp_secret, u.totp_last_step, u.recovery_codes
  FROM fin.auth_tokens t JOIN fin.users u ON u.id = t.user_id
  WHERE t.token_hash = p_hash AND t.kind = p_kind AND t.expires_at > now()
$$;

-- E-Mail bestätigen (Token wird verbraucht)
CREATE OR REPLACE FUNCTION fin.auth_verify_email(p_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, public AS $$
DECLARE v uuid;
BEGIN
  DELETE FROM fin.auth_tokens WHERE token_hash = p_hash AND kind = 'verify' AND expires_at > now() RETURNING user_id INTO v;
  IF v IS NOT NULL THEN UPDATE fin.users SET email_verified = true WHERE id = v; END IF;
  RETURN v;
END $$;

-- Passwort über Mail-Link setzen: Token verbrauchen, alle Sitzungen beenden, Adresse gilt als bestätigt
CREATE OR REPLACE FUNCTION fin.auth_reset_password(p_hash bytea, p_pw text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = fin, public AS $$
DECLARE v uuid;
BEGIN
  DELETE FROM fin.auth_tokens WHERE token_hash = p_hash AND kind = 'reset' AND expires_at > now() RETURNING user_id INTO v;
  IF v IS NOT NULL THEN
    UPDATE fin.users SET pw_hash = p_pw, email_verified = true WHERE id = v;
    DELETE FROM fin.sessions WHERE user_id = v;
    DELETE FROM fin.auth_tokens WHERE user_id = v AND kind = 'reset';
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fin.auth_mark_verified(p_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = fin, public AS $$
  UPDATE fin.users SET email_verified = true WHERE id = p_user;
$$;

REVOKE ALL ON FUNCTION fin.auth_lookup2(text), fin.auth_totp_used(uuid, bigint, text), fin.auth_token_create(uuid, text, bytea, int),
  fin.auth_token_user(bytea, text), fin.auth_verify_email(bytea), fin.auth_reset_password(bytea, text), fin.auth_mark_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fin.auth_lookup2(text), fin.auth_totp_used(uuid, bigint, text), fin.auth_token_create(uuid, text, bytea, int),
  fin.auth_token_user(bytea, text), fin.auth_verify_email(bytea), fin.auth_reset_password(bytea, text), fin.auth_mark_verified(uuid) TO finanzen_app;

RESET ROLE;

-- Schemaversion (für spätere Migrationen)
CREATE TABLE IF NOT EXISTS fin.meta (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE fin.meta OWNER TO finanzen_owner;
INSERT INTO fin.meta VALUES ('schema_version', '2') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
GRANT SELECT ON fin.meta TO finanzen_app;
