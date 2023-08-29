const Service = require('node-windows').Service;

// Create a new service object
const svc = new Service({
  name:'cronicle',
  // script: 'C:\\Users\\Cronicle\\cronicle-edge\\dist\\bin\\cronicle.js',
  script:  require('path').join(__dirname,'cronicle.js'),
});

// Listen for the "uninstall" event so we know when it's done.
svc.on('uninstall',function(){
  console.log('Uninstall complete.');
  console.log('The service exists: ', svc.exists);
});

// Uninstall the service.
svc.uninstall(10); // add some lag