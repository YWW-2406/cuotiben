'use strict';
/* 本地数据存储：IndexedDB（照片以 Blob 形式保存，适合存储大量图片） */
var DB = (function () {
  var DB_NAME = 'cuotiben';
  var STORE = 'questions';
  var db = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      if (!window.indexedDB) return reject(new Error('当前浏览器不支持本地存储'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error || new Error('数据库打开失败')); };
    });
  }

  function toPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('数据库操作失败')); };
    });
  }

  /* 新增错题，record: { subject, date, note, imgData(Blob), w, h, created } */
  function add(record) {
    return open().then(function () {
      return toPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).add(record));
    });
  }

  /* 读取全部错题 */
  function getAll() {
    return open().then(function () {
      return toPromise(db.transaction(STORE).objectStore(STORE).getAll());
    });
  }

  /* 按 id 删除 */
  function remove(id) {
    return open().then(function () {
      return toPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    });
  }

  /* 更新已有错题（record 须含 id，整条替换） */
  function update(record) {
    return open().then(function () {
      return toPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
    });
  }

  return { open: open, add: add, getAll: getAll, remove: remove, update: update };
})();
