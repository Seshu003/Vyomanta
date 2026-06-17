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

cd /home/frappe/frappe-bench

# Ensure site config and logs directories exist
mkdir -p sites/lms.render/logs

# Write/verify site_config.json configuration so the web server can connect to the DB
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

# Route Redis traffic to internal local instance
bench set-redis-cache-host redis://127.0.0.1:6379
bench set-redis-queue-host redis://127.0.0.1:6379
bench set-redis-socketio-host redis://127.0.0.1:6379

bench use lms.render

# Update Procfile port mapping to Render's dynamic binding
sed -i "s/bench serve.*/bench serve --port ${PORT:-8000}/g" ./Procfile

# Start the server (binds instantly to port 8000/dynamic port)
echo "Starting Frappe Bench web server..."
bench --site lms.render serve --port ${PORT:-8000}
