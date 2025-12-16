# Overview

This is a fork of [jhuckaby/Cronicle](https://github.com/jhuckaby/Cronicle) with quite a few new features and APIs. The main purpose of this fork is to make Cronicle work better with Docker, and add some experimental features that are only expected in Cronicle 2.0 (a.k.a. Orchestra)

![image](https://github.com/user-attachments/assets/10aabe1a-59be-47ab-a785-341c0e3cc56a)

# Install:
## Docker
Images:
 - dockerhub (auto, releases, arm64, arm/v7 supported): **cronicle/edge:latest  | cronicle/edge:v1.x.y**
 - github (auto, main/releases): **ghcr.io/cronicle-edge/cronicle-edge:main  | ghcr.io/cronicle-edge/cronicle-edge:v1.x.y**
 - arm32/v7 (raspberry pi): **cronicle/edge-pi:latest**  (before 1.14.1)
 - classic cronicle: **cronicle/cronicle:latest**  (it also supports manager/worker entrypoint)

```bash
 # test latest and greatest:
 docker run -it --rm -p 3012:3012 ghcr.io/cronicle-edge/cronicle-edge:main manager

# typical local setup
 mkdir -p $HOME/cron && docker run -d --name cron \
 --hostname manager1 \
 -p 3012:3012 --restart always  \
 -v $HOME/cron:/opt/cronicle/data  \
 -e CRONICLE_secret_key=mysecretKey  \
 cronicle/edge:v1.13.3 manager 
```

Above images based on alpine linux, and include some demo items and storage engines (S3/SQL). If you need custom base image or to include you custom patches, build you own image, use Dockerfile as an example:
```bash
docker build -t cronicle/edge -f Dockerfile .
```
Instead of using tini as entrypoint you can use Docker's --init option.

# Building locally / on VM (linux/windows)

```bash
git clone https://github.com/cronicle-edge/cronicle-edge && cd cronicle-edge

# basic install, will bundle cronicle into "dist" folder using default storage engine (Filesystem)
./bundle
# add extra storage engines, and custom output dir:
./bundle /path/to/dir --S3 --mysql
# check all options:
./bundle --help
```
To avoid including some demo stuff on initial setup (e.g. Config Keys) set this variable CRONICLE_setup=minimal

After bundling is complete you can use this commands to start cronicle:
```bash
./dist/bin/manager # (or worker, use --help for more option) - will start cronicle on foregound in manager/worker mode (meant for docker entrypoint)
./dist/bin/control.sh start  # (use --help for more info) - will start cronicle on background
./dist/bin/cronicle.js --options # use if need to set custom option
```
bundle script will also print instruction how to setup cronicle as service.

## Try multinode setup with Docker swarm
```bash
# before deploying stack, set up a secret_key as docker secret, e.g.:
# echo 123456 | docker secret create secret_key -
docker stack deploy --compose-file  Docker/LocalCluster.yaml cron_stack
# then go to admin/servers and add nodes called worker1 and worker2 manually
```

You can import some demo jobs from **sample_conf/backup** file. This can be done via UI (see below). Check [Docker](https://github.com/cronicle-edge/cronicle-edge/tree/main/Docker) section for Dockerfile and other examples for real life use. 

# What's new

# Plugins
 - ### Shell Plugin Improvements:

1) Syntax highlighting with editor themes and full-screen mode (F11)
2) Fixed ANSI colors in live-log and console output 
3) Parameters - you can define custom parameters in configuration under *params* property and inject them in your shell scripts.  E.g. if you have `params.sql.query1` config you can refer to it in the script as [/sql/query1]
4) Arguments - similar to parameter, but those are defined in event properties and injected as env variables (e.g. $ARG1). Those also could be changed by non-editor users. Arguments could also be used with other plugins (HTTP and Workflow, see below)

- ### Workflow Plugin
Use this plugin to run multiple jobs in parallel, or invoke same event multiple times with different parameters. You can run group of jobs based on category or event title prefix. To run same event multiple times you can specify comma separated argument list (argument value will be available as `JOB_ARG` env variable).

- ### SSH Plugin
Run your code snippets on remote machines over SSH. No cronicle agent or openssh installation needed! Can even run on Windows hosts (if openssh is configured). Use with WF plugin to run on multiple hosts.

- ### Docker Plugin
Run your code snippet in docker. Cronicle will set up container with your script and optionally some other files. Can use local or remote (over ssh) docker engine.

- ### Kubernetes Plugin
Run your code snippet in Kubernetes. Cronicle will set up pod or kubernetes job using your script. Will use local kubeconfig by default, but can specify custom configuration via secrets.

- ### Terminal Plugin  
Run your script in actual terminal emulator (using node-pty) in order to capture colorful outputs and simple animations of your cli tools.

# New Storage Engines
- ### S3 Storage in the box
  Refer to [1.5.14 release notes](https://github.com/cronicle-edge/cronicle-edge/releases/tag/v1.5.14) for more details.

- ### SQL Engines
  Supports SQLite (local), Postgre, Mysql, Oracle, MSSQL. Can be added during bundling (e.g. ./bundle --sqlite --mysql --oracle). If using SQLite, can specify local db (file) in manager entrypoint and storage-cli (e.g. ./dist/bin/manager --sqlite /path/to/sql.db)
  
- ### KV Engines
  Supports LevelDB and LMDB  (./bundle --level --lmdb). Along with SQLite this could be a good alternative for default FS Engine, since it's using 1 or several files.

# New Features
### SSO login via oauth2
Can verify user via common oauth providers (github, google, authentik, microsof, keyclock, etc)
Refer to [1.11.1 release notes](https://github.com/cronicle-edge/cronicle-edge/releases/tag/v1.11.1) for more details.

### Serve cronicle on custom base path
Ever wanted to serve cronicle on ```https://myserver/cron``` ? Just set ```base_path = /cron``` in config.json or set ```CRONICLE_base_path=/cron``` variable 
Refer to [1.10.1 release notes](https://github.com/cronicle-edge/cronicle-edge/releases/tag/v1.10.1) for more details.

### Can display timestamps in HH24 vs AM/PM
Just set ui.hh24 = true configuration or via variable CRONICLE_ui__hh24 = 1 

### Config tab
You can now set any config right from GUI and without restarting cronicle. You can set custom configuration keys that would override values you have set in `config.json`. You can set nested keys via dot notation  (e.g. `params.sql.query`). You can also use multi-line values as config value. Please note - that does not apply to storage and webserver config. You also cannot get or set secret key.

### Global Env / Secrets
On Config Tab you can also specify environment variables using "KEY = VALUE" syntax (dotenv style). Those variables will be available while executing shellplug events. You can also encrypt this data turning this feature into "secret management". Data is encrypted using AES256 and cronicle secret key. For the best result set `secret_key` as docker secret, use https proxy between clients and manager nodes, and set log level config to be <= 6.

### Config Viewer
Config tab also contains a link to a config viewer. It will list all actual config values (besides `secret_key`).

### Import/Export (Backup) API
You now can import/export cronicle metadata from UI (under schedule tab). It's basically same this as "storage-cli import/export", so you can export your jobs from classic cronicle using CLI, and import it to the new version using GUI.  There is also a sample backup file (under sample_conf/backup). It contain plenty of demo jobs describing cronicle-edge features and showing some extra tricks (e.g. running Java/PySpark snippets). Please note - the Import API will ignore server and plugin info to prevent state change (you need to set up servers and custom plugins separately).

### LiveLog new API
There is a new default API to view live log. It does not require direct connection to worker nodes, all goes through manager. So it will work with no issues even under Docker/Swarm and/or reverse https proxy. New API is dead simple and based on polling N lines of log file (not real time updates via websocket). It co-exists with the classic websocket API. You can set `ui.live_log_ws=1` config to switch back to older version. The new livelog is always available under `/console?id=yourjobid` link.

### External auth with AD
When creating user check "external" checkbox and use samaccountname as username. To specify AD domain use `ad_domain` config, or you can also add it to username (e.g. `user@my.domain.com`).

### Run API limitations
In order to modify shell plug script and run it manually user should have Admin or Editor privilege. Run privilege only let user to invoke event by ID (on UI side editor will be locked). Run users will still be able to modify arguments. This way you can let external teams to run some jobs without allowing running arbitrary code.

### Schedule - Graph View
Scheduled event page can be viewed as a graph. It's useful to track chained jobs. Graph nodes are clickable. You can also delete event via graph (press del key). There is also cycled chain auto-detection. E.g. if a job is chaining from itself, you'll see a warning.

### Event History Chart
Main page will include a bar chart showing last N completed jobs. It will help to quickly catch failed or long running jobs. You can set default job count and scale (linear/logarithmic) via `ui.job_chart_limit` and `ui.job_chart_scale` configs.

### Webhooks 
 You can now set webhooks as an object in config under *web_hooks* property and then refer to it by key. This way you can specify custom headers and options. You can also rout "text" key (with cronicle message) to some other key, even if it's nested.
 There are also some new special webhooks:
 - admin_web_hook - mirrors Activity Log
 - oninfo_web_hook - subset of admin webhook, showing server related activity (e.g. server restart)
 - onupdate_web_hook - subset of admin webhook, showing event related activity (e.g. event creation)
 admin_web_hook will also catch graceful (e.g. docker restart) and emergency (js exception) shutdown

You can find detailed examples on default demo configs (on config tab).
There are also few more options to set webhook notifications (on start, on completion and on error).

### Warning state
Along with success and failure outcome, you can now use warning. Just exit with code -1 or 255.

### Handling frequent jobs
To reduce pressure from frequently running jobs you can now:
 - check "Silent" checkbox. This will prevent jobs to get into global run history ("Completed") and Activity log. It will keep producing records under Event History.
 - set "Log Expire" to some small value. This option just overrides `job_data_expire_days` for a specific job. If you set 1 it will only keep logs for current day. 2 - since yesterday, and so on.

### Event token
You can generate a token to run specific event instead of creating global API key. To reset token - disable and enable this option again.

### Git integration
 - Github - HMAC signature check is supported. You can set `git_hub_key` config to verify signature. If not set cronicle will use `secret_key` (if x-signature-header is included in the request).
 - Gitlab - you can use cronicle API key as web hook secret key, but you can always bake API key or token in web hook url.
 - You can also automatically execute "git add / git commit / git push remote branch" on clicking backup button or even on each metadata update. First you need to set git repo (with auth) in your data folder. Then use related configs (there is an example in demo configs).
 - Before starting new Docker container you can also set `GIT_REPO` variable, so manager entrypoint will attempt to use this repo to setup data folder instead of running standard set up.

### Hybrid schedule
You can extend cron schedule by specifying extra minute ticks. This is helpful for uneven/one-time schedules. If you just specify hours/minutes without the date (e.g. 16:45 or 3PM), it will trigger job to run every day at that time. You can use full timestamp to run the job at specific time just once (e.g. 2021-01-01  16:45).

### Debug options
When running event manually there are some one-time options you can set:
 - omit chaining/notification
 - use terminal emulator (to capture colorized output)
 - sudo : run event under same user as main process (useful if plugin is running under non-root user, but main process is under root)

### Terminology 
master/slave renamed to manager/worker

### UI and security improvements
There are several other UI improvements. E.g. tooltips or extra filters. Some info is removed from public APIs to avoid exposing potentially sensitive data to everyone.

# Just some demo  screenshots
## Main page with job chart:
![image](https://user-images.githubusercontent.com/31977106/109408727-3cdbfe00-795a-11eb-8797-38f3b7e43ae3.png)
## ShellPlug new look:
![image](https://user-images.githubusercontent.com/31977106/109408828-3f8b2300-795b-11eb-9aef-3f2847142fc5.png)
## Graph View:
![image](https://user-images.githubusercontent.com/31977106/109408861-8711af00-795b-11eb-8b19-d660692ed7f9.png)
## Workflow Plugin:
![image](https://user-images.githubusercontent.com/31977106/152707347-1b0f25e0-d0a6-4ef1-99e0-be6fc14e20d9.png)
## SSH Plugin:
![image](https://user-images.githubusercontent.com/31977106/182756155-d551f17b-9713-4b87-9bb9-2f6c62d207c3.png)
## Import/Backup 
![image](https://user-images.githubusercontent.com/31977106/109408915-1a4ae480-795c-11eb-861c-e6f19cec2858.png)
## Config Tab:
![image](https://user-images.githubusercontent.com/31977106/109408939-4e260a00-795c-11eb-9fcc-7d0a7d18e758.png)
## Extra ticks & job token:
![image](https://user-images.githubusercontent.com/31977106/109409018-0489ef00-795d-11eb-800b-1b83b57d9863.png)

