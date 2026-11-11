# Consultorio Dr. Juan David Sánchez Males — v1

## Instalación (una sola vez)
1. Crea un proyecto NUEVO en Supabase (no uses el de Tecnigráficas).
2. SQL Editor → pega todo `01_schema.sql` → Run.
3. Project Settings → API: copia la URL y la anon/publishable key en `web/config.js`.
4. Authentication → Sign In / Providers → Email: si no quieres confirmar correos, desactiva "Confirm email".
5. Sube la carpeta `web` con Netlify Drop.

## Primer ingreso
- La PRIMERA persona que se registre queda como Administrador (que sea Juan David).
- Los demás se registran desde "Regístrate" y quedan pendientes hasta que él los active en Usuarios.

## Roles
- Administrador: todo (usuarios y precios incluidos).
- Odontólogo: todo menos usuarios y precios.
- Asistente: agenda, pacientes y pagos. No ve la historia clínica.

## Recordatorios
- Por ahora: botón "Recordar por WhatsApp" en cada cita (abre WhatsApp con el mensaje listo).
- Siguiente fase: envío automático con botones Confirmar/Cancelar vía WhatsApp Cloud API (coexistencia).
