import struct, base64
from telethon.sessions.string import StringSession
from telethon.sync import TelegramClient
from pyrogram.storage.storage import Storage
from pyrogram import utils

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