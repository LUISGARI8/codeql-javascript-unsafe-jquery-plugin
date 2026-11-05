# Talonario virtual de rifas

Página única (`index.html`) para vender una rifa desde el celular o el computador.

## Qué hace
- **Crear la rifa**: nombre, premio, valor por número, número Nequi y titular, lotería con la que juega y fecha del sorteo. Talonario de 100 (00–99) o 1000 (000–999) números.
- **Marcar números**: cada número puede estar *Libre*, *Apartado* (pendiente de pago) o *Pagado*.
- **Cobrar por Nequi**: desde un número apartado se envía al cliente, por WhatsApp, el mensaje con el Nequi al que debe pagar.
- **Comprobante por WhatsApp**: al marcar un número como pagado se genera una **imagen de comprobante** (rifa, número, sello PAGADO, cliente, valor, Nequi, referencia, fechas y código de verificación). Se puede compartir directo a WhatsApp desde el celular, descargar, o enviar en texto al chat del cliente.
- **Bloqueo**: un número pagado queda bloqueado: no se puede apartar, vender de nuevo ni liberar. Antes de guardar, la página vuelve a leer el número para impedir que dos vendedores lo vendan al mismo tiempo.

## Cómo usarlo
- Abrir `index.html` en el navegador. Fuera de claude.ai los datos se guardan **solo en ese dispositivo** (localStorage).
- `talonario.html` es la misma página en el formato de publicación de claude.ai, donde los datos se comparten en línea entre todos los vendedores con acceso.
