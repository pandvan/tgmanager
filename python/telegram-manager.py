import initialize
from configuration import Config
from constants import ROOT_ID
from services.database import init_database, getItem
from services.tgclients import TGClients
from services.fsapi import FSApi
from pyrogram import idle
from aiohttp import web
import asyncio
import logging

Log = logging.getLogger("APP")

for name, logger in logging.root.manager.loggerDict.items():
  if name.startswith('pyrogram') or name.startswith('pymongo'):
    if isinstance(logger, logging.Logger):
      logger.setLevel(logging.WARNING)

async def start():
  Log.info('Starting application')

  init_database()

  for user in Config.telegram.users:
    await TGClients.add_client(user.id, user.api_id, user.api_hash, getattr(user, 'bot_token', None))
  
  TGClients.check()
  

  if Config.http.enabled:
    # start http server
    Log.info('starting http server')
    from httpserver import web_server

    server = web.AppRunner(web_server())
    await server.setup()
    await web.TCPSite(server, Config.http.host, Config.http.port).start()
  
  # if Config.telegram.bot_token:
  #   from tgbot import Bot
  #   await Bot.start()


  await idle()
  # mess = await current.get_message(1916139954, 696)

  # Log.info(mess)

  # media = TelegramApi.get_media_from_message( mess )

  # Log.info(media)

  # file = await current.get_file(media.filedata.media_id, media.filedata.access_hash, media.filedata.file_reference)

  # Log.info( len(file.bytes) )

  # f = open("/Users/fatshotty/Desktop/mount3/testee/fede.js", "rb")
  # file_id = TelegramApi.generate_id()
  # file_part = await current.send_file_parts(
  #   file_id, 
  #   0, 
  #   1, 
  #   f.read()
  # )

  # mess = await current.move_file_to_chat(
  #   1916139954, file_id, 1, 'fede.js', mime
  # )

  # uploader = Uploader(current, "fede.js")

  # await uploader.execute(f)

  # root = getItem(ROOT_ID)
  # fsapi = FSApi(root)

  # f = open('/Users/fatshotty/Desktop/2024-06-18 18-08-43_edit2 18.31.41.mkv', 'rb')

  # service = await fsapi.create_file_with_content('/Screen Recording.mov')

  # if service is not None:
  #   await service.execute( f )


  # filejs = getItem('u8qryi8xb9')

  # f = open("/Users/fatshotty/Desktop/mount3/testee/Screen.mov", "wb")
  # service = await fsapi.read_file_content('Screen Recording.mov', f)

  # if service is not None:
  #   await service.execute( f )
  
  # f.close()


loop = asyncio.get_event_loop()

if __name__ == "__main__":
  Log.info('INIT')
  try:
      loop.run_until_complete(start())
  except KeyboardInterrupt:
      pass
  except Exception as err:
      logging.error(err.with_traceback(None))
  finally:
      # loop.run_until_complete(cleanup())
      loop.stop()
      logging.info("STOP")


