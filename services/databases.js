const {Config} = require('../config');
const Logger = require('../logger');
const ShortUniqueID = require('short-unique-id');
const Events = require('events');
const Process = require('process');

const ShortUUID = new ShortUniqueID({length: 10});

const Event = new Events.EventEmitter();

const Log = new Logger('DB');

let DB = null;

async function initDatabase() {

  if (Config.db.startsWith('mongo://') ) {
    // TODO: use mongo
  } else {
    // use Realm
    const RealmDB = require('../databases/realm');
    DB = new RealmDB();
    await DB.init(Event);
  }

}

async function getFilesByMessageIdAndChannel(msgId, channel) {
  return DB.getFilesByMessageIdAndChannel(msgId, channel);
}

async function getFolderByChannel(channelId) {
  return DB.getFolderByChannel(channelId);
}

async function getItem(id) {
  return DB.getItem(id);
}

async function getChildren(folderId, type) {
  return DB.getChildren(folderId, type);
}

async function removeItem(itemId) {
  return DB.removeItem(itemId);
}

async function getItemByFilename(filename, parent, type) {
  return DB.getItemByFilename(filename, parent, type);
}

async function createFolder(folder, parent) {
  return DB.createFolder(folder, parent);
}

async function updateFolder(folder, data, parent) {
  return DB.updateFolder(folder, data, parent);

}

async function createFile(file, parent) {
  return DB.createFile(file, parent);
}

async function updateFile(file, data, parent) {
  return DB.updateFile(file, data, parent);
}

async function write(fn) {
  return DB.write(fn);
}

function writeSync(fn) {

  return DB.writeSync(fn);

}

function remap(item) {
  return DB.remap(item);
}

async function getTelegramData(key) {
  return DB.getTelegramData(key);
}

async function setTelegramData(data) {
  return DB.setTelegramData(data);
}

async function close() {
  return DB.close();
}

function isUUID(value) {
  return DB.isUUID(value);
}


module.exports = {
  // ROOT_ID,
  initDatabase,
  getItem,
  getChildren,
  write,
  writeSync,
  getItemByFilename,
  getTelegramData,
  setTelegramData,
  removeItem,
  close,
  remap,
  isUUID,
  Event,
  createFolder,
  updateFolder,
  createFile,
  updateFile,
  getFilesByMessageIdAndChannel,
  getFolderByChannel
};
