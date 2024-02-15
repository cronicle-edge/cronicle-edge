
# Config samples

check this  repo for more details:
https://github.com/cronicle-edge/edge-storage-engine

## S3
```bash
# install driver
npm i @aws-sdk/client-s3 @aws-sdk/lib-storage

# or bundle:
./bundle --s3

# spin up test S3 server (minio)
docker run -it -p 9000:9000 -p 9001:9001 --entrypoint sh minio/minio -c 'mkdir -p /export/cronicle && minio server /export --console-address ":9001"'

```

```json
    "Storage": {
        "engine": "S3",
        "AWS": {
            "endpoint": "http://localhost:9000",
            "endpointPrefix": false,
            "forcePathStyle": true,
            "region": "us-east-1",
            "hostPrefixEnabled": false,
            "credentials": {
                "accessKeyId": "minioadmin",
                "secretAccessKey": "minioadmin"
            },
            "correctClockSkew": true,
            "maxRetries": 5,
            "httpOptions": {
                "connectTimeout": 5000,
                "timeout": 5000
            }
        },
        "S3": {
            "fileExtensions": true,
            "params": {
                "Bucket": "cronicle"
            }
        }
    },
```
## SFTP:
```bash
# install driver
npm i ssh2-sftp-client

# bundle:
./bundle --sftp

# spin up test sftp server:
docker run --rm --name sftp -p 8080:8080 -p 2022:22 -it atmoz/sftp  'cron:cronpass:::cronicle'
```

```json
	"Storage": {
		"engine": "Sftp",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"Sftp": {
			"base_dir": "cronicle",
			"key_namespaces": 1,
			"connection": {
				"host": "localhost",
				"port": 2022,
				"username": "cron",
				"password": "cronpass"
			}
		}
	},
```


## Lmdb:
```bash
# install driver:
npm i lmdb

# bundle (need to install driver in dist folder upon bundling):
./bundle --lmdb
```

```json
	"Storage": {
		"engine": "Lmdb",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
        "Lmdb": { "dbpath":"data-lmdb", "compression":true }       
    },
```
```bash
# install driver:
npm i level

# bundle:
./bundle --level
```
## Level:
```json
	"Storage": {
		"engine": "Level",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
        "Level": { "dbpath":"data-level"}       
    },
```

## SQL 
```bash
 npm i knex
```
To bundle common sql drivers (mysql/pgsql/oracle/mssql) in a single engine:
```
./bundle --sql
```
###  sqlite:
```bash
# install sqlite driver
 npm i sqlite3 

# bundle (install driver in dist folder upon bundling completion)
./bundle --sqlite
```

```json
	"Storage": {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "sqlite3",
			"table": "cronicle",
			"useNullAsDefault": true,
			"connection": {
				"filename": "/tmp/cronicle.db"
			}
		}
	},
```
### MySQL:
```bash
# install driver:
npm i mysql2

# or bundle:
./bundle --mysql

# spin up test db:
docker run --name mysql -e MYSQL_ROOT_PASSWORD=cronicle -e MYSQL_USER=cronicle -e MYSQL_PASSWORD=cronicle -e MYSQL_DATABASE=cron -p 3306:3306 -d mysql

```
```json
	"Storage": {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "mysql2",
			"table": "cronicle",
			"connection": {
                "host": "localhost",
				"user": "cronicle",
				"password": "cronicle",
				"database": "cron"
			}
		}
	},
	
```
### Postgres:
```bash
# install driver
 npm i pg

 # or bundle:
 ./bundle --pgsql

 # spin up test db:
 docker run --name pg -e POSTGRES_USER=cronicle -e POSTGRES_PASSWORD=cronicle -e POSTGRES_DB=cron -p 5432:5432 -d postgres
```
```json
	"Storage": {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "pg",
			"table": "cronicle",
			"connection": {
                "host": "localhost",
				"user": "cronicle",
				"password": "cronicle",
				"database": "cron"
			}
		}
	},
```
### MSSQL:
```bash
# install driver 
 npm i tedious

# or bundle:
./bundle --mssql

# spin up test db:
docker run --name mssql -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=StrongPassword123!" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
```
```json
	"Storage": {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "mssql",
			"table": "cronicle",
			"connection": {
				"host": "localhost",
				"user": "SA",
				"password": "StrongPassword123!",
				"database": "master"
			}
		}
	},
```
### Oracle:
```bash
# install driver
npm i oracledb 

# or bundle:
./bundle --oracle

# spin up test db:
docker run -d -p 1521:1521 --name ora -e APP_USER=cronicle -e APP_USER_PASSWORD=cronicle  -e ORACLE_PASSWORD=cronicle -e ORACLE_DATABASE=CRON  gvenzl/oracle-free
```

```json
	"Storage": {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "oracledb",
			"table": "cronicle",
			"connection": {
                "connectString": "localhost:1521/CRON",
				"user": "cronicle",
				"password": "cronicle"
			}
		}
	},
	
```