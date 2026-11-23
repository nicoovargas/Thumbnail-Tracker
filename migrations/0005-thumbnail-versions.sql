CREATE TABLE miniatura_imagenes (
 miniatura_id TEXT NOT NULL REFERENCES miniaturas(id) ON DELETE CASCADE,
 imagen_id TEXT NOT NULL UNIQUE REFERENCES images(id),
 orden INTEGER NOT NULL CHECK(orden>=0 AND orden<10),
 PRIMARY KEY(miniatura_id,orden)
);
INSERT INTO miniatura_imagenes(miniatura_id,imagen_id,orden) SELECT id,imagen_path,0 FROM miniaturas;
