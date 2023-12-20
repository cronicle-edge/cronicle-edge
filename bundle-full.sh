DIST="${1:-dist}"

npm i esbuild -g 
# add some extra packages for plugin/engin bundling
npm i level redis@3.1.2 ssh2-sftp-client @aws-sdk/client-s3 @aws-sdk/lib-storage knex knex-stringcase pg pg-query-stream mysql2 
mkdir -p $DIST && cp -r htdocs $DIST/

# external js

mkdir -p $DIST/htdocs/js/external && cp \
 node_modules/jquery/dist/jquery.min.js \
 node_modules/moment/min/moment.min.js \
 node_modules/moment-timezone/builds/moment-timezone-with-data.min.js \
 node_modules/chart.js/dist/Chart.min.js \
 node_modules/jstimezonedetect/dist/jstz.min.js \
 node_modules/zxcvbn/dist/zxcvbn.js \
 node_modules/socket.io/client-dist/socket.io.min.js \
 node_modules/ansi_up/ansi_up.js \
 node_modules/jquery-ui-dist/jquery-ui.min.js \
 node_modules/graphlib/dist/graphlib.min.js \
 node_modules/vis-network/dist/vis-network.min.js \
 node_modules/xss/dist/xss.min.js \
 node_modules/jquery-datetimepicker/build/jquery.datetimepicker.full.min.js \
 node_modules/diff/dist/diff.min.js \
 $DIST/htdocs/js/external/

mkdir -p $DIST/htdocs/css && cp \
  node_modules/font-awesome/css/font-awesome.min.css \
  node_modules/@mdi/font/css/materialdesignicons.min.css \
  node_modules/jquery-ui-dist/jquery-ui.min.css \
  node_modules/jquery-datetimepicker/build/jquery.datetimepicker.min.css \
  node_modules/pixl-webapp/css/base.css \
 $DIST/htdocs/css/

mkdir -p $DIST/htdocs/fonts && cp \
 node_modules/font-awesome/fonts/* \
 node_modules/@mdi/font/fonts/*.woff \
 node_modules/pixl-webapp/fonts/*.woff \
 $DIST/htdocs/fonts/

# code mirror css

cat \
	node_modules/codemirror/lib/codemirror.css \
	node_modules/codemirror/theme/darcula.css \
	node_modules/codemirror/theme/solarized.css \
	node_modules/codemirror/theme/gruvbox-dark.css \
	node_modules/codemirror/addon/scroll/simplescrollbars.css \
	node_modules/codemirror/addon/display/fullscreen.css \
	node_modules/codemirror/addon/lint/lint.css \
	node_modules/codemirror/addon/fold/foldgutter.css \
  >  $DIST/htdocs/css/codemirror.css

# codemirror js
cat \
	 node_modules/codemirror/lib/codemirror.js \
	 node_modules/codemirror/addon/scroll/simplescrollbars.js \
	 node_modules/codemirror/addon/edit/matchbrackets.js \
	 node_modules/codemirror/addon/selection/active-line.js \
	 node_modules/codemirror/addon/fold/foldgutter.js \
	 node_modules/codemirror/addon/fold/foldcode.js \
	 node_modules/codemirror/addon/fold/brace-fold.js \
	 node_modules/codemirror/addon/fold/indent-fold.js \
	 node_modules/codemirror/mode/powershell/powershell.js \
	 node_modules/codemirror/mode/javascript/javascript.js \
	 node_modules/codemirror/mode/python/python.js \
	 node_modules/codemirror/mode/perl/perl.js \
	 node_modules/codemirror/mode/shell/shell.js \
	 node_modules/codemirror/mode/groovy/groovy.js \
	 node_modules/codemirror/mode/clike/clike.js \
	 node_modules/codemirror/mode/properties/properties.js \
	 node_modules/codemirror/addon/display/fullscreen.js \
	 node_modules/codemirror/mode/xml/xml.js \
	 node_modules/codemirror/mode/sql/sql.js \
   node_modules/js-yaml/dist/js-yaml.js \
	 node_modules/codemirror/addon/lint/lint.js \
	 node_modules/codemirror/addon/lint/json-lint.js \
	 node_modules/codemirror/addon/lint/yaml-lint.js \
	 node_modules/codemirror/addon/mode/simple.js \
	 node_modules/codemirror/mode/dockerfile/dockerfile.js \
	 node_modules/codemirror/mode/toml/toml.js \
	 node_modules/codemirror/mode/yaml/yaml.js \
	 node_modules/codemirror/addon/comment/comment.js \
   node_modules/jsonlint-mod/lib/jsonlint.js \
   | esbuild --minify >  $DIST/htdocs/js/codemirror.min.js

# ----- MAIN ------ #

# CRONICLE FRONT END

cat \
  node_modules/pixl-webapp/js/md5.js \
  node_modules/pixl-webapp/js/oop.js \
  node_modules/pixl-webapp/js/xml.js \
  node_modules/pixl-webapp/js/tools.js \
  node_modules/pixl-webapp/js/datetime.js \
  node_modules/pixl-webapp/js/page.js \
  node_modules/pixl-webapp/js/dialog.js \
  node_modules/pixl-webapp/js/base.js \
  | esbuild --minify --keep-names >  $DIST/htdocs/js/common.min.js

cat htdocs/js/app.js \
  htdocs/js/pages/Base.class.js \
  htdocs/js/pages/Home.class.js \
  htdocs/js/pages/Login.class.js \
  htdocs/js/pages/Schedule.class.js \
  htdocs/js/pages/History.class.js \
  htdocs/js/pages/JobDetails.class.js \
  htdocs/js/pages/MyAccount.class.js \
  htdocs/js/pages/Admin.class.js \
  htdocs/js/pages/admin/Categories.js \
  htdocs/js/pages/admin/Servers.js \
  htdocs/js/pages/admin/Users.js \
  htdocs/js/pages/admin/Plugins.js \
  htdocs/js/pages/admin/Activity.js \
  htdocs/js/pages/admin/APIKeys.js \
  htdocs/js/pages/admin/ConfigKeys.js \
  htdocs/js/pages/admin/Secrets.js \
  | esbuild --minify --keep-names >  $DIST/htdocs/js/combo.min.js

cp htdocs/index-bundle.html  $DIST/htdocs/index.html
  
cp -r bin  $DIST/
cp -r sample_conf/  $DIST/conf
cp package.json  $DIST/bin/

esbuild --bundle --minify --platform=node --outdir=$DIST/bin/ \
 --external:../conf/config.json --external:../conf/storage.json --external:../conf/setup.json \
bin/storage-cli.js

esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  bin/shell-plugin.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  bin/test-plugin.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  bin/url-plugin.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  --loader:.node=file bin/ssh-plugin.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  bin/workflow.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/  bin/run-detached.js

esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines node_modules/pixl-server-storage/engines/Filesystem.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines node_modules/pixl-server-storage/engines/Redis.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines engines/S3.js
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines --loader:.node=file engines/Sftp.js

# LevelDb - to make it work you can copy native module
# from: node_modules/classic-level/prebuilds/linux-x64/node.napi.musl.node  (or whatever platform)
# to: $DIST/bin/engines/prebuilds/linux-x64/
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines engines/Level.js

# SQL engine bundle up knex, mysql2 and pg. You can install sqlite3, oracledb, tedious separetly
esbuild --bundle --minify --platform=node --external:oracledb --external:sqlite3 \
 --external:mysql  --external:tedious --external:pg-native --external:better-sqlite3  \
 --outdir=$DIST/bin/engines engines/SQL.js

# Lmdb, need to install lmdb separetly (npm i lmdb)
esbuild --bundle --minify --platform=node --outdir=$DIST/bin/engines --external:lmdb engines/Lmdb.js 

# --- CRONICLE.JS
esbuild --bundle --minify --keep-names --platform=node --outfile=$DIST/bin/cronicle.js lib/main.js

# --- fix  formidable
esbuild --bundle --minify --keep-names --platform=node --outdir=$DIST/bin/plugins node_modules/formidable/src/plugins/*.js

# clean up 
rm -rf $DIST/bin/jars $DIST/bin/cms $DIST/bin/cronicled.init $DIST/bin/importkey.sh $DIST/bin/debug.sh \
  $DIST/bin/java-plugin.js $DIST/bin/install.js $DIST/bin/build.js $DIST/bin/build-tools.js $DIST/conf/backup

# generate sample secret_key. Please change, or use CRONICLE_secret_key variable to overwrite
cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1 > $DIST/conf/secret_key
#chmod 400 $DIST/conf/secret_key

chmod -R 755 $DIST/bin
