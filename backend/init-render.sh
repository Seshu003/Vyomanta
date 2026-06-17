#!/bin/bash
set -e

# Optimize memory usage for constrained environments (512MB RAM)
export MALLOC_ARENA_MAX=2

# Start local Redis server (used inside the container for caching & queues)
echo "Starting local Redis server..."
redis-server --daemonize yes

until redis-cli ping | grep -q PONG; do
  echo "Waiting for local Redis..."
  sleep 1
done
echo "Local Redis is up and running."

# Wait for the cloud MySQL/MariaDB database
echo "Waiting for Cloud Database (${DB_HOST}:${DB_PORT})...."
python3 -c "
import socket
import time
import os
import sys

host = os.environ.get('DB_HOST')
port = int(os.environ.get('DB_PORT', '3306'))

if not host:
    print('Error: DB_HOST environment variable is not defined.')
    sys.exit(1)

while True:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2)
            s.connect((host, port))
            print('Cloud DB is reachable!')
            break
    except Exception as e:
        print(f'Waiting for Cloud DB at {host}:{port}... Details: {e}')
        time.sleep(3)
"

cd /home/frappe/frappe-bench

# Add db_ssl_ca configuration to common_site_config.json so all connections use TLS
if [ -f "sites/common_site_config.json" ]; then
    python3 -c "
import json
path = 'sites/common_site_config.json'
with open(path, 'r') as f:
    config = json.load(f)
config['db_ssl_ca'] = '/etc/ssl/certs/ca-certificates.crt'
with open(path, 'w') as f:
    json.dump(config, f, indent=4)
"
fi

# Apply environment configurations dynamically
bench set-mariadb-host "$DB_HOST"
bench set-config -g db_port "$DB_PORT"
bench set-config -g allow_cors "$FRONTEND_URL"
bench set-config -g ignore_csrf 1

# Route Redis traffic to internal local instance
bench set-redis-cache-host redis://127.0.0.1:6379
bench set-redis-queue-host redis://127.0.0.1:6379
bench set-redis-socketio-host redis://127.0.0.1:6379

# Ensure site logs directory exists (fixes FileNotFoundError for database.log)
mkdir -p sites/lms.render/logs

# Render runs on ephemeral filesystems. Recreate the site folder configuration if missing.
if [ ! -f "sites/lms.render/site_config.json" ]; then
    echo "Site config folder for lms.render not found. Restoring configuration..."
    
    # Write the site config pointing to the external DB
    cat <<EOF > sites/lms.render/site_config.json
{
 "db_name": "$DB_NAME",
 "db_password": "$DB_PASSWORD",
 "db_type": "mariadb",
 "db_user": "$DB_USER",
 "db_ssl_ca": "/etc/ssl/certs/ca-certificates.crt",
 "encryption_key": "frappe-encryption-key-for-security",
 "allow_cors": "$FRONTEND_URL"
}
EOF
    
    # Check if the database has tables and is fully initialized
    echo "Checking database initialization state..."
    if ! mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --ssl-ca=/etc/ssl/certs/ca-certificates.crt -e "USE $DB_NAME; SHOW TABLES;" 2>/dev/null | grep -q "tabPatch Log"; then
        echo "Database is empty, uninitialized, or partially initialized. Executing bench reinstall..."
        
        # Run bench reinstall to safely recreate tables and populate default metadata/users
        bench --site lms.render reinstall --yes --admin-password "${ADMIN_PASSWORD:-admin}"

        # Install payments and LMS apps
        echo "Installing payments & lms applications..."
        bench --site lms.render install-app payments
        bench --site lms.render install-app lms
    else
        echo "Database is already seeded. Connecting to existing database tables..."
        bench --site lms.render set-config allow_cors "$FRONTEND_URL"
        bench --site lms.render clear-cache
    fi
    
    bench use lms.render
fi

# Run database migrations (ensures schemas align with installed codebase)
echo "Running database migrations..."
bench --site lms.render migrate

# Update Procfile port mapping to Render's dynamic binding
sed -i "s/bench serve.*/bench serve --port ${PORT:-8000}/g" ./Procfile

# Start the server (binds instantly to port 8000/dynamic port)
# We serve only the web process directly to keep RAM within 512MB limit on free tier
echo "Starting Frappe Bench web server..."
bench --site lms.render serve --port ${PORT:-8000}
