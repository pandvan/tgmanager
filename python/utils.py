import struct, base64
from telethon.sessions.string import StringSession
from telethon.sync import TelegramClient
from pyrogram.storage.storage import Storage
from services.database import getItem, TGFolder, TGFile, ROOT_ID



# pyrogram fix:
from pyrogram import utils

def get_peer_type_new(peer_id: int) -> str:
    peer_id_str = str(peer_id)
    if not peer_id_str.startswith("-"):
        return "user"
    elif peer_id_str.startswith("-100"):
        return "channel"
    else:
        return "chat"

utils.get_peer_type = get_peer_type_new


class EventEmitter(object):
  callbacks = None

  def on(self, event_name, callback):
    if self.callbacks is None:
      self.callbacks = {}

    if event_name not in self.callbacks:
      self.callbacks[event_name] = [callback]
    else:
      self.callbacks[event_name].append(callback)

  def emit(self, event_name, *args):
    if self.callbacks is not None and event_name in self.callbacks:
      for callback in self.callbacks[event_name]:
        if callback is not None:
          callback(*args)


def get_item_channel(folder: TGFolder | TGFile, allow_root = True):

    # add extra fields such as `path`
    item = getItem(folder.id)
    items = list(reversed(item.path[0:])) # slice array

    items.insert(0, folder)

    for currentItem in items:
      if currentItem.id == ROOT_ID:
        # returns ROOT channel if it is allowed, else None
        return currentItem.channel if allow_root else None
      if currentItem.channel:
        return currentItem.channel
    
    return None


# Both Telethon and Pyrogram should be Installed
# Made only for Educational Purpose
# New-dev0 (2021)


def telethon_to_unpack(string):
    ST = StringSession(string)
    return ST


def pack_to_pyro(data, ses, api_id):
    Dt = Storage.SESSION_STRING_FORMAT
    return (
        base64.urlsafe_b64encode(
            struct.pack(Dt, data.dc_id, int(api_id), None, data.auth_key.key, ses.id, ses.bot)
        )
        .decode()
        .rstrip("=")
    )


async def start_session(string, api_id, api_hash):
    client = TelegramClient(StringSession(string), api_id, api_hash)
    await client.start()
    ml = await client.get_me()
    return ml


async def tele_to_pyro(string, api_id, api_hash):
    DL = telethon_to_unpack(string)
    MK = await start_session(string, api_id, api_hash)
    return pack_to_pyro(DL, MK, api_id)

async def tele_to_pyro_me(string, api_id, me):
    DL = telethon_to_unpack(string)
    return pack_to_pyro(DL, me, api_id)


# Example
# telethon_string = "1A.....Z="
# tele_to_pyro(telethon_string)