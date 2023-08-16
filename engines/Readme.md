
# Config samples

check this  repo for more details:
https://github.com/cronicle-edge/edge-storage-engine

## S3
```bash
npm i @aws-sdk/client-s3 @aws-sdk/lib-storage
```

```json
"Storage": {
		"engine": "S3",
		"AWS": {
			"endpoint": "http://minio:9000",
			"endpointPrefix": false,
			"s3ForcePathStyle": true,
			"region": "east",
			"hostPrefixEnabled": false,
			"accessKeyId": "admin",
			"secretAccessKey": "admin_secret",
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
npm i ssh2-sftp-client
```

```json
	"Storage": {
		"engine": "Sftp",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"Sftp": {
			"base_dir": "data",
			"key_namespaces": 1,
			"connection": {
				"host": "192.168.0.1",
				"port": 22,
				"username": "root",
				"password": "P@ssword"
			}
		}
	},
```


## Lmdb:
```bash
npm i lmdb
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
npm i level
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
###  sqlite:
```bash
 npm i sqlite3
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
	}
```
### MySQL:
```bash
npm i mysql2
```
```json
		"SQL": {
			"client": "mysql2",
			"table": "cronicle",
			"connection": {
				"host": "localhost",
				"user": "dbUser",
				"password": "dbPassword",
				"database": "dbName"
			}
		}
```
### Postgres:
```bash
 npm i pg
```
```json
		"SQL": {
			"client": "pg",
			"table": "cronicle",
			"connection": {
				"host": "localhost",
				"user": "dbUser",
				"password": "dbPassword",
				"database": "dbName"
			}
		}
```
### MSSQL:
```bash
 npm i tedious
```
```json
		"SQL": {
			"client": "mssql",
			"table": "cronicle",
			"connection": {
				"host": "localhost",
				"user": "dbUser",
				"password": "dbPassword",
				"database": "dbName"
			}
		}
```
### Oracle:
```bash
npm i oracledb 
```

```json
		"SQL": {
			"client": "oracledb",
			"table": "cronicle",
			"connection": {
                        "connectString": "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost...)))",
				"user": "dbUser",
				"password": "dbPassword",
				"database": "oracleSchema"
			}
		}
```