

export async function getChildren(folderId) {
  const rsp = await fetch(`/folders/${folderId}` );
  return await rsp.json();
}

/**
 * Format bytes as human-readable text.
 * 
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use 
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * 
 * @return Formatted string.
 */
export function humanFileSize(bytes, si=false, dp=1, lower=false) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si 
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] 
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10**dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + ( lower ? units[u].toLowerCase() : units[u]);
}

export async function deleteFolder(id) {
  const rsp = await fetch(`/folders/${id}`, {
    method: 'DELETE'
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}


export async function deleteFile(id) {
  const rsp = await fetch(`/files/${id}`, {
    method: 'DELETE'
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}

export async function mergeFiles(items) {
  const first = items.splice(0, 1)[0];
  const rsp = await fetch(`/files/${first.id}/merge?part_ids=${items.map(i => i.id).join(',')}`, {
    method: 'put'
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}

export async function createFolder(currentFolder, foldername) {
  const rsp = await fetch(`/folders/${currentFolder.id}/folder/${foldername}`, {
    method: 'POST'
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}


export async function modifyFolder(folder, data) {
  const rsp = await fetch(`/folders/${folder.id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}

export async function modifyFile(file, data) {
  const rsp = await fetch(`/files/${file.id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}


export async function moveFilesAndFolders(destFolder, items) {
  const rsp = await fetch(`/folders/${destFolder.id}/move`, {
    method: 'POST',
    body: JSON.stringify({items: items.map(i => i.id)})
  });
  if (rsp.status < 200 || rsp.status > 299) {
    throw Error('response error');
  }
  return true;
}