/// install node-windows first:
///  npm install -g node-windows
///  npm link node-windows

var Service = require('node-windows').Service;

console.log(require('path').join(__dirname,'cronicle.js'))
// Create a new service object
var svc = new Service({
  name:'cronicle',
  description: 'Cronicle scheduler',
  // script: 'C:\\Users\\Cronicle\\cronicle-edge\\dist\\bin\\cronicle.js',
  script:  require('path').join(__dirname,'cronicle.js'),
  scriptOptions: '--foreground --manager',  // might set this in cofig.json too
  stopparentfirst: true  
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install',function(){
  setTimeout(() => {
    console.log("Starting service");
    svc.start();
  }, 10000); // some lag for slow systems
  
});

svc.install();