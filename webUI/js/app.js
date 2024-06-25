import React from 'react';
import Folder from './folder';


export default function App() {

  return (
    <section className="table" >
      <header className="table-row table-header">
        <div className="table-col">
          Name
        </div>
        <div className="table-col text-center">
          Size
        </div>
      </header>
      <Folder source='0000000000' showFolders={true} showFiles={true} />
    </section>
  )

}