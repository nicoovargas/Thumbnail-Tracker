-- Aplicada a la base existente. Las cuentas se aprovisionan por el propietario, con hashes privados.
ALTER TABLE users RENAME COLUMN email TO username;
UPDATE setup SET consumed=1 WHERE id=1;
