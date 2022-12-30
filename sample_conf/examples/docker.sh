
# some docker commands to set up various storage systems
# should work out of the box with sample storage configs (if using localhost)

# Postgres:
docker run -d --name postgres -e POSTGRES_PASSWORD='P@ssword' -e POSTGRES_DB=cronicle POSTGRES_USER=cronicle -p 5432:5432 -d postgres

# Mysql
docker run --name mysql -p 3306:3306 -e MYSQL_DATABASE=cronicle -e MYSQL_ROOT_PASSWORD='P@ssword' -d mysql

# S3 / minio  - create "cronicle" bucket in UI (http://localhost:9001), use "minioadmin" as user and password
docker run -d -p 9000:9000 -p 9001:9001 quay.io/minio/minio server /data --console-address ":9001"

# Redis 
docker run -d --name redis -p 6379:6379 redis

