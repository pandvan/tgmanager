const {Config} = require('./config');
const DB = require('./services/databases');
const FS = require('fs');
const Path = require('path');
const Logger = require('./logger');
const FSApi = require('./services/fs-api');

const Log = new Logger('STRM');


let RootFolderPath = '';


async function loopFolder(folderId, folderPath) {

  Log.debug('loop', folderPath);

  try {
    FS.mkdirSync( folderPath, {recursive: true} );
  } catch(e){
    Log.error(`cannot create folder ${folderPath}`, e);
  }

  const children = await DB.getChildren(folderId);

  for (const child of children){

    if ( child.state != 'ACTIVE') continue;

    if ( child.type == 'folder' ) {

      const folderChild = Path.join(folderPath, child.filename)

      await loopFolder(child.id, folderChild );
    } else {

      createFile(child, folderPath);

    }

  }

}

function createFile(file, folderPath) {
  if ( file.content && file.content.byteLength > 0 ) {

    FS.writeFileSync( Path.join(folderPath, file.filename), Buffer.from(file.content));

  } else {

    FS.writeFileSync( Path.join(folderPath, `${file.filename}.strm`), Config.strm.url.replace('{fileid}', file.id ), 'utf-8' );

  }
}

async function deleteItem(item) {
  const parent = await DB.getItem(item.parentfolder);
  const fullpath = await FSApi.buildPath(parent, Path.sep);
  let fullpathFile = Path.join(RootFolderPath, fullpath, item.filename );
  if ( item.type == 'folder' ) {
    FS.rmSync(fullpathFile, {
      force: true,
      recursive: true,
      maxRetries: 2
    })
  } else {
    // let {filename} = item;
    // fullpathFile = Path.join(RootFolderPath, fullpath, filename );
    try {
      if ( item.content && item.content.byteLength > 0 ) {
        FS.unlinkSync( fullpathFile );  
      } else {
        FS.unlinkSync( `${fullpathFile}.strm` );
      }
    } catch(e) {
      Log.warn(`cannot delete file ${fullpathFile} - [${item.id}]`);
    }
    
  }
}

async function init(ID, rootFolder) {
  RootFolderPath = rootFolder;
  Log.info('starting in', RootFolderPath);

  if ( Config.strm.clearFolder ) {
    Log.warn('folder will be removed and re-created');
    FS.rmSync(RootFolderPath, {
      force: true,
      recursive: true,
      maxRetries: 2
    });
    FS.mkdirSync( RootFolderPath, {recursive: true} );
  }
  
  Log.warn('populate folder...');
  await loopFolder(ID, RootFolderPath);
  Log.warn('folder ready!');

  DB.Event.on('created', async (item) => {
    if ( item.state !== 'ACTIVE' ) return;
    if ( item.type == 'folder' ) {
      // create folder in FS
      const fullpath = await FSApi.buildPath(item, Path.sep);
      await loopFolder(item.id, Path.join( RootFolderPath, fullpath ) );
    } else {
      // this is a file
      const parent = await DB.getItem(item.parentfolder);
      const fullpath = await FSApi.buildPath(parent, Path.sep);
      createFile(item, Path.join( RootFolderPath, fullpath ) );
    }
  });

  DB.Event.on('deleted', deleteItem);

  DB.Event.on('changed', async (itemNew, itemOld) => {
    const fullpathNew = await FSApi.buildPath(itemNew, Path.sep);

    if ( itemOld ) {
      // TODO: check delete folder parameter
      await deleteItem(itemOld);
    }
    if (itemNew.type == 'folder') {
      await loopFolder(itemNew.id, Path.join( RootFolderPath, fullpathNew ) );
    } else {

      let filePath = await FSApi.buildPath(itemNew, Path.sep);
      let parentPath = Path.dirname(filePath);

      await createFile(itemNew, Path.join( RootFolderPath, parentPath ));
    }
  });

}


module.exports = {init};