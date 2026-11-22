-- Existing payments require the designer's confirmation as well.
ALTER TABLE pagos ADD COLUMN confirmado_disenador_at TEXT;
ALTER TABLE pagos ADD COLUMN confirmado_encargado_at TEXT;
ALTER TABLE pagos ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
UPDATE pagos SET confirmado_encargado_at=CASE WHEN pagado=1 THEN updated_at ELSE NULL END,pagado=0;
