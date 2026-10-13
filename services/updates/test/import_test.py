import importlib.util, sqlite3, tempfile, unittest
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('legacy',root/'scripts/prepare-legacy-import.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ImportTest(unittest.TestCase):
 def test_preserves_optouts_duplicates_and_real_timestamps(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=Path(tmp)/'source.csv';source.write_text('Timestamp,Email\n3/1/2025 22:32:57,New@example.com\n3/2/2025 22:32:57,new@example.com\n3/1/2025 22:32:57,out@example.com\n3/1/2025 22:32:57,bad-address\n')
   sql,report=module.prepare(source,'ab'*32,'Asia/Kuching',{'owner_confirmed_original_wording':True,'known_opt_outs':False})
   db=sqlite3.connect(':memory:');db.executescript((root/'migrations/0001_initial.sql').read_text());db.execute("INSERT INTO subscribers(id,email,status,source,signup_at,consent_version,unsubscribe_hash,last_confirmation_at) VALUES('existing','out@example.com','unsubscribed','website',1,'old','hash',0)");db.executescript(sql);db.executescript(sql)
   self.assertEqual(report['unique_valid'],2);self.assertEqual(report['invalid_rows'],1);self.assertEqual(report['duplicate_rows'],1)
   self.assertEqual(db.execute('SELECT count(*) FROM subscribers').fetchone()[0],2)
   self.assertEqual(db.execute("SELECT status,consent_version FROM subscribers WHERE email='out@example.com'").fetchone(),('unsubscribed','old'))
   new=db.execute("SELECT status,confirmed_at,signup_at FROM subscribers WHERE email='new@example.com'").fetchone();self.assertEqual(new,('subscribed',None,1740839577))
   self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0],0)
if __name__=='__main__':unittest.main()
