
/****
 Storage plugin will attempt to create target table automatically if not exist
 If you user has no access to create tables, request DBA to create it for you
*/

----- pg
CREATE TABLE cronicle (
  K varchar(256) PRIMARY KEY,
  V bytea,
  created timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated timestamptz DEFAULT CURRENT_TIMESTAMP
)


---------  mysql 
CREATE TABLE cronicle (
  K varchar(256) PRIMARY KEY,
  V longblob,
  created datetime DEFAULT CURRENT_TIMESTAMP,
  updated datetime DEFAULT CURRENT_TIMESTAMP
)


---------  mssql 
CREATE TABLE cronicle (
  K varchar(256) PRIMARY KEY,
  V varbinary(MAX),
  created datetime2 DEFAULT CURRENT_TIMESTAMP,
  updated datetime2 DEFAULT CURRENT_TIMESTAMP
)

------- oracle 
CREATE TABLE cronicle (
  K varchar(256) PRIMARY KEY,
  V blob,
  created timestamp DEFAULT CURRENT_TIMESTAMP,
  updated timestamp DEFAULT CURRENT_TIMESTAMP
)

---- optional index for "updated" field
---- CREATE INDEX cronicle_updated_index ON cronicle (updated DESC) 