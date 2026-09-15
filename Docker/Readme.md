
# Building image
You can use Dockerfile in this folder as an example. You need to use tini as an entrypoint to avoid Cronicle to become zombie. If using alpine make sure to install following packages: 
```bash
apk add util-linux bash openssl procps coreutils
```
You will likely need to use some different base image (e.g. python or java). In this case it's useful to use multistage build to speed up build times and reduce some space. Just add nodejs-current package to your base image, and run "npm install" using node image and then just copy node modules. Use DockerfileMultistage file as example.

# Running using docker run
For debugging/development start interactive bash, then use *manager* or *worker* command 
```
docker run -it -p 3012:3012 cronicle/cronicle:edge bash
```
For better security I'd suggest to run cronicle as root user, while setting shell plugin to run as non-root. This way you can limit access to data/conf directories and some other files with sensitive data. This is how demo image is set.

For actual use:
- use *manager* as entrypoint command
- always use same hostname (e.g. manager1 ) to make data folder portable (without tweaking server list/groups later)
- for persistant volume you only need to map *data* folder
- to run cronicle "as a service" use *restart=always* option
- you may optionally use *--net=host* parameter if interacting with cronicle nodes on other machines (in this case don't use hostname parameter, it should be the same as your host)
- `CRONICLE_manager=1` starts Cronicle immediately (only use it on a single-manager node/cluster)

```bash
install -d -m 0700 "$HOME/.config/cronicle" "$HOME/data"
if [ ! -s "$HOME/.config/cronicle/secret_key" ]; then
  (umask 077; openssl rand -hex 32 > "$HOME/.config/cronicle/secret_key")
fi
chmod 0600 "$HOME/.config/cronicle/secret_key"
docker run -d --hostname manager1 --restart=always \
  -e CRONICLE_manager=1 \
  -e CRONICLE_secret_key_file=/run/secrets/cronicle_secret_key \
  -p 3012:3012 \
  -v "$HOME/data:/opt/cronicle/data" \
  --mount type=bind,source="$HOME/.config/cronicle/secret_key",target=/run/secrets/cronicle_secret_key,readonly \
  cronicle/cronicle:edge manager
```

The key file must be reused by every node that belongs to the cluster.  Keep a
protected backup: replacing it after data has been written makes encrypted
values unreadable.  A file mount keeps the key value out of `docker inspect`
environment output.

# Running cronicle in swarm mode (as service)
If you have multiple machines it's a good idea to set up a swarm cluster. It's still could be useful on a single node too, since you'll get access to secret management, and will be able easily update/roll back cronicle version.

## step 1 - create network and volume

 ```bash
 docker network create --driver overlay cron
 sudo install -d -m 0700 /var/data/cronicle/v1/data # run on the manager node; keep this in line with step 3 (--mount arg)
 ```
 

## step 2 - create secrets

```bash
openssl rand -hex 32 | docker secret create secret_key -
docker secret create cronicle.key /path/to/key.pem
```
Create `secret_key` only once and reuse that external Docker secret for every
node.  Do not pass its value through a service environment variable.
The key is used for data encryption. Use bin/cms (openssl wrapper) to generate one:
 ```
  bin/cms new cronicle > /path/to/key.pem
```

## step 3 start manager node

```bash
   docker service create --name cron --hostname manager1 -p 3016:3012 \
   --secret  source=secret_key,target=secret_key,uid=0,mode=0400  \
   --secret  source=cronicle.key,target=cronicle.key,uid=0,mode=0400  \
   --mount  type=bind,source=/var/data/cronicle/v1/data,destination=/opt/cronicle/data \
   --network cron  \
   -e CRONICLE_manager=1  \
   -e CRONICLE_secret_key_file=/run/secrets/secret_key  \
   cronicle/cronicle:edge-1.0.0 manager
```

If secret is meant to be accessed by non-root user then just specify it as ```--secret secret_name```, so it will have default 444 permission

## if any error starting service, check logs

```docker service logs cron --tail 50```

## to force restart service

```docker service update --force cron```

## upgrade to a new version

```docker service update --image cronicle/cronicle:edge-1.1.0 cron```

## roll back to previous version

```docker service update --rollback cron```

## step 4: create a worker node if needed. Worker node is stateless and doesn't need storage

```bash
   docker service create --name worker1 --hostname worker1 \
   --secret  source=secret_key,target=secret_key,uid=0,mode=0400  \
   --secret  source=cronicle.key,target=cronicle.key,uid=0,mode=0400  \
   --network cron  \
   -e CRONICLE_secret_key_file=/run/secrets/secret_key  \
   cronicle/cronicle:edge-1.0.0 worker
```

# Docker compose
If you are going to deploy a cluster (1 manager + N workers), it's better to use docker compose, describing all nodes in one file. Even better - install Portainer (docker GUI), so you can just copy/paste those yaml files into web GUI and get the cluster up and running with a single button click. Here are some sample compose files:
- LocalCluster.yaml - basic example with  1 manager and 1 worker
- LocalClusterAnchor.yaml - multinode cluster, using docker anchors ("templates")


# Setting up https reverse proxy with nginx

For a single node cronicle Nginx should be a good reverse/https proxy solution. You can install it over docker as well. Check nginx.conf file and command below. It assumes ssl keys will be placed under /run/secrets/ as master.crt and master.key
Edit nginx.conf to set different key path, or change/add other routes if needed (if running multiple apps on same server)
Then:

```bash
 docker run -d --net=host --name nginx --restart=always nginx
 docker cp nginx.conf nginx:/etc/nginx/nginx.conf
 docker restart nginx
 ```

 If using Swarm with multiple nodes, you can also check out traefik.


