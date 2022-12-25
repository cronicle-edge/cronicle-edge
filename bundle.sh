
npm i esbuild -g 
npm i level redis@3.1.2 ssh2-sftp-client @aws-sdk/client-s3 @aws-sdk/lib-storage knex pg pg-query-stream mysql2 
mkdir -p dist && cp -r htdocs dist/

mkdir -p dist/htdocs/js/external && cp \
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
 node_modules/jsonlint-mod/lib/jsonlint.js \
 node_modules/js-yaml/dist/js-yaml.min.js \
 node_modules/diff/dist/diff.min.js \
dist/htdocs/js/external/

mkdir -p dist/htdocs/codemirror  && cp -r \
  node_modules/codemirror/addon \
  node_modules/codemirror/mode \
  node_modules/codemirror/lib \
  node_modules/codemirror/theme \
 dist/htdocs/codemirror

mkdir -p dist/htdocs/css && cp \
  node_modules/font-awesome/css/font-awesome.min.css \
  node_modules/@mdi/font/css/materialdesignicons.min.css \
  node_modules/jquery-ui-dist/jquery-ui.min.css \
  node_modules/jquery-datetimepicker/build/jquery.datetimepicker.min.css \
  node_modules/pixl-webapp/css/base.css \
dist/htdocs/css/

mkdir -p dist/htdocs/fonts && cp \
 node_modules/font-awesome/fonts/* \
 node_modules/@mdi/font/fonts/*.woff \
 node_modules/pixl-webapp/fonts/*.woff \
dist/htdocs/fonts/

cp -r node_modules/pixl-webapp/js dist/htdocs/js/common
cp htdocs/index-dev.html dist/htdocs/index.html
  
cp -r bin dist/
cp -r sample_conf/ dist/conf
cp package.json dist/bin/

esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/storage-cli.js

esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/shell-plugin.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/test-plugin.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/url-plugin.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/  --loader:.node=file bin/ssh-plugin.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/workflow.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/  bin/run-detached.js

esbuild --bundle --minify --platform=node --outdir=dist/bin/engines node_modules/pixl-server-storage/engines/Filesystem.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/engines node_modules/pixl-server-storage/engines/Redis.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/engines engines/S3.js
esbuild --bundle --minify --platform=node --outdir=dist/bin/engines --loader:.node=file engines/Sftp.js

# LevelDb - to make it work copy you can copy native module
# from node_modules/classic-level/prebuilds/linux-x64/node.napi.musl.node  (or whatever platform)
# to dist/bin/engines/prebuilds/linux-x64/
esbuild --bundle --minify --platform=node --outdir=dist/bin/engines engines/Level.js

# SQL engine bundle up knex, mysql2 and pg. You can install sqlite3, oracledb, tedious separetly
esbuild --bundle --minify --platform=node --external:oracledb --external:sqlite3 \
 --external:mysql  --external:tedious --external:pg-native --external:better-sqlite3  \
 --outdir=dist/bin/engines engines/SQL.js

# Lmdb, need to install lmdb separetly (npm i lmdb)
esbuild --bundle --minify --platform=node --outdir=dist/bin/engines --external:lmdb engines/Lmdb.js 


esbuild --bundle --minify --keep-names --platform=node --outfile=dist/bin/cronicle.js lib/main.js

chmod -R 755 dist/bin

cat \
  htdocs/js/common/md5.js \
  htdocs/js/common/oop.js \
  htdocs/js/common/xml.js \
  htdocs/js/common/tools.js \
  htdocs/js/common/datetime.js \
  htdocs/js/common/page.js \
  htdocs/js/common/base.js \
  | esbuild --minify > dist/htdocs/js/common.min.js

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
  | esbuild --minify > dist/htdocs/js/combo.min.js


cat \
	 htdocs/codemirror/lib/codemirror.js \
	 htdocs/codemirror/addon/scroll/simplescrollbars.js \
	 htdocs/codemirror/addon/edit/matchbrackets.js \
	 htdocs/codemirror/addon/selection/active-line.js \
	 htdocs/codemirror/addon/fold/foldgutter.js \
	 htdocs/codemirror/addon/fold/foldcode.js \
	 htdocs/codemirror/addon/fold/brace-fold.js \
	 htdocs/codemirror/addon/fold/indent-fold.js \
	 htdocs/codemirror/mode/powershell/powershell.js \
	 htdocs/codemirror/mode/javascript/javascript.js \
	 htdocs/codemirror/mode/python/python.js \
	 htdocs/codemirror/mode/perl/perl.js \
	 htdocs/codemirror/mode/shell/shell.js \
	 htdocs/codemirror/mode/groovy/groovy.js \
	 htdocs/codemirror/mode/clike/clike.js \
	 htdocs/codemirror/mode/properties/properties.js \
	 htdocs/codemirror/addon/display/fullscreen.js \
	 htdocs/codemirror/mode/xml/xml.js \
	 htdocs/codemirror/mode/sql/sql.js \
	 htdocs/codemirror/addon/lint/lint.js \
	 htdocs/codemirror/addon/lint/json-lint.js \
	 htdocs/codemirror/addon/lint/yaml-lint.js \
	 htdocs/codemirror/addon/mode/simple.js \
	 htdocs/codemirror/mode/dockerfile/dockerfile.js \
	 htdocs/codemirror/mode/toml/toml.js \
	 htdocs/codemirror/mode/yaml/yaml.js \
	 htdocs/codemirror/addon/comment/comment.js \
   | esbuild --minify > dist/htdocs/js/codemirror.min.js
