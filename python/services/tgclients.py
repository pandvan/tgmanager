from services.telegram import TelegramApi
import logging

Log = logging.getLogger('TGApi')

Clients = []

class TGClients():

  current_client = -1

  @staticmethod
  async def add_client(name: str, apiId: str, apiHash: str, bot = None, session = None):
    client = TelegramApi(name, apiId, apiHash, bot, session = session)
    await client.start()
    await client.get_me()
    Log.info(f"Login OK for user: {client.username}, is premium: {client.is_premium} and can upload {client.max_upload_parts} parts")
    Clients.append( client )


  @staticmethod
  def get_all_clients():
    return Clients
  
  @staticmethod
  def check():
    for client in Clients:
      if client.is_bot == False:
        return True
    
    raise Exception("At least one client for upload is needed")
  
  @staticmethod
  def next_client(upload = False):
    TGClients.current_client += 1
    if TGClients.current_client > len(Clients) - 1:
      TGClients.current_client = 0
    client = Clients[ TGClients.current_client ]
    Log.info(f"using client: {client.username}")

    if upload and client.is_bot:
      return TGClients.next_client(upload)

    return client