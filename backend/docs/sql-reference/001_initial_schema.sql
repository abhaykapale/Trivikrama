CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS monitor;

DO $$
BEGIN
    CREATE TYPE incident_status AS ENUM (
        'open',
        'investigating',
        'resolved',
        'closed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE incident_severity AS ENUM (
        'critical',
        'high',
        'medium',
        'low',
        'informational'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE incident_source AS ENUM (
        'rule',
        'ai',
        'both'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE alert_type AS ENUM (
        'rule',
        'ai'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE rule_status AS ENUM (
        'active',
        'disabled',
        'archived'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE rule_type AS ENUM (
        'match',
        'count',
        'sequence'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE rule_severity AS ENUM (
        'critical',
        'high',
        'medium',
        'low',
        'informational'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE user_role AS ENUM (
        'admin',
        'security_engineer',
        'soc_analyst'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE collector_status_enum AS ENUM (
        'online',
        'degraded',
        'offline'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE audit_action AS ENUM (
        'login',
        'logout',
        'incident_create',
        'incident_update',
        'incident_status_change',
        'incident_assign',
        'rule_create',
        'rule_update',
        'rule_delete',
        'rule_enable',
        'rule_disable',
        'rule_import',
        'user_create',
        'user_update',
        'user_delete',
        'config_change',
        'collector_config_change'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
