from services.telegram import TelegramApi
import logging

Log = logging.getLogger('TGApi')

UserClients = []
BotClients = []

class TGClients():

  current_user_client = -1
  current_bot_client = -1

  @staticmethod
  async def add_client(name: str, apiId: str, apiHash: str, bot = None, session = None):
    client = TelegramApi(name, apiId, apiHash, bot, session = session)
    Log.info(f"Loading tg-client: {name}")
    await client.start()
    await client.get_me()
    Log.info(f"Login OK for user: {client.username}, is premium: {client.is_premium} and can upload {client.max_upload_parts} parts")

    if client.is_bot:
      BotClients.append(client)
    else:
      UserClients.append(client)

    return client


  @staticmethod
  def get_all_clients():
    return UserClients + BotClients
  
  @staticmethod
  def check():
    if len(UserClients) > 0:
      return True
    else:
      raise Exception("At least one user client for upload is needed")
  
  @staticmethod
  def next_client(download = False):

    client = None

    if download and len(BotClients) > 0:
      TGClients.current_bot_client += 1
      if TGClients.current_bot_client > (len(BotClients) - 1):
        TGClients.current_bot_client = 0
      client = BotClients[ TGClients.current_bot_client ]
    

    if client is None:

      TGClients.current_user_client += 1
      if TGClients.current_user_client > (len(UserClients) - 1):
        TGClients.current_user_client = 0
      client = UserClients[ TGClients.current_user_client ]


    Log.info(f"using client: {client.username} (Bot: {client.is_bot} for download: {download})")
    
    return client
