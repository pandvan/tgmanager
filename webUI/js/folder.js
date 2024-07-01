import React, {useState, useEffect, useCallback, useMemo} from 'react';
import * as Utils from './utils';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrashCan, faFolderClosed } from '@fortawesome/free-solid-svg-icons'
import { faFile, faFolderOpen } from '@fortawesome/free-regular-svg-icons'


function Item(props) {
  const {item, depth} = props;
  const [showFolder, setShowFolder] = useState(false);
  const size = useMemo(() => {
    return item.sizes.reduce((acc, value) => acc += value, 0);
  }, [item]);

  const onClick = useCallback(() => {
    if ( item.type == 'folder' ) {
      setShowFolder(!showFolder);
    }
  }, [item, showFolder])


  return (
    <>
      <div className="table-row" >
        <div className="table-col col-name" style={{'paddingLeft': `${depth * 10}px`}} >
          {item.type == 'folder' ? (
            <FontAwesomeIcon icon={showFolder ? faFolderOpen : faFolderClosed} onClick={onClick} />
          ) : (
            <FontAwesomeIcon icon={faFile} />
          )}
          {item.filename}
          <FontAwesomeIcon icon={faPen} />
          <FontAwesomeIcon icon={faTrashCan} />
        </div>
        <div className="table-col text-right col-size">
          {size ? Utils.humanFileSize(size, false, 2) : ''}
        </div>
      </div>
      {showFolder && <Folder source={item.id} depth={depth + 1} showFolders={true} showFiles={true} />}
    </>
  )
}

export default function Folder(props) {

  const {source, depth, showFolders, showFiles} = props;
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const items = await Utils.getChildren(source);
      setFolders( items.filter( i => i.type === 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 ) );
      setFiles( items.filter( i => i.type !== 'folder').sort( (f1, f2) => f1.filename > f2.filename ? 1 : -1 ) );
      setLoading(false);
    }
    load();
  }, [source])

  return (
    <>
      {loading && (<h5>loading</h5>)}
      {!loading && showFolders &&
        folders.map((folder) => {
          return (
            <Item key={folder.id} item={folder} depth={(depth || 0) + 1} />
          )
        })}
      {!loading && showFiles &&
        files.map((file) => {
          return (
            <Item key={file.id} item={file} depth={(depth || 0) + 1} />
          )
        })}
    </>
  );
}