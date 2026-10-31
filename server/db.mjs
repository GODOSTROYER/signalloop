import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export class Store {
  constructor(dir) {
    mkdirSync(dir,{recursive:true}); this.dir=resolve(dir);
    this.db=new DatabaseSync(resolve(dir,'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,data TEXT NOT NULL,at TEXT NOT NULL);`);
    this.getStmt=this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?');
    this.listStmt=this.db.prepare('SELECT data FROM entities WHERE kind=? ORDER BY rowid');
    this.putStmt=this.db.prepare('INSERT INTO entities(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data');
  }
  get(kind,id){const r=this.getStmt.get(kind,id);return r?JSON.parse(r.data):null;}
  all(kind){return this.listStmt.all(kind).map(r=>JSON.parse(r.data));}
  put(kind,data){this.putStmt.run(kind,data.id,JSON.stringify(data));return data;}
  delete(kind,id){this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind,id);}
  log(event,data){this.db.prepare('INSERT INTO audit(event,data,at) VALUES(?,?,?)').run(event,JSON.stringify(data),new Date().toISOString());}
  audit(){return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 100').all().map(r=>({...r,data:JSON.parse(r.data)}));}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
