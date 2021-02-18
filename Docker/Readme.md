# Setting up https reverse proxy with nginx

Below command assumes that ssl keys will be placed under /run/secrets/ as master.crt and master.key
Edit nginx.conf to set different key path, or change/add other routes if needed (if running multiple apps on same server)
Then:

```bash
 docker run -it  -d --net=host -v ~/secrets:/run/secrets  --name nginx --restart=always nginx
 docker cp nginx.conf nginx:/etc/nginx/nginx.conf
 docker restart nginx
 ```
