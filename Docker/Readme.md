
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

```bash
docker run -it --hostname manager1 --restart always \
  -e CRONICLE_manager=1 \
  -e CRONICLE_secret_key=123456 \
  -p 3017:3012 \
  -v $HOME/data:/opt/cronicle/data \
  cronicle:pwsh manager
```

# Running cronicle in swarm mode (as service)
If you have multiple machines it's a good idea to set up a swarm cluster. It's still could be useful on a single node too, since you'll get access to secret management, and will be able easily update/roll back cronicle version.

## step 1 - create network and volume

 ```bash
 docker network create --driver overlay cron
 mkdir -p /var/data/cronicle/v1/data # could be anything, but should be in line with step 3 (--mount arg)
 ```
 

## step 2 - create secrets (optional)

```bash
echo -n "MyCronSecretKey" | docker secret create secret_key -
docker secret create cronicle.key /path/to/key.pem
```
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


