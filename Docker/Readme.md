
# Running cronicle in swarm mode

## step 1 - create network

 ```docker network create --driver overlay cron```

## step 2 - create secrets

```bash
echo -n "MyCronSecretKey" | docker secret create secret_key -
docker secret create cronicle.key /path/to/key.pem
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
   docker service create --name cron_worker1 --hostname worker1 \
   --secret  source=secret_key,target=secret_key,uid=0,mode=0400  \
   --secret  source=cronicle.key,target=cronicle.key,uid=0,mode=0400  \
   --network cron  \
   cronicle/cronicle:edge-1.0.0
```

# Setting up https reverse proxy with nginx

Below command assumes that ssl keys will be placed under /run/secrets/ as master.crt and master.key
Edit nginx.conf to set different key path, or change/add other routes if needed (if running multiple apps on same server)
Then:

```bash
 docker run -d --net=host -v ~/secrets:/run/secrets  --name nginx --restart=always nginx
 docker cp nginx.conf nginx:/etc/nginx/nginx.conf
 docker restart nginx
 ```
