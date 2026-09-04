import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from 'jsr:@supabase/server@^1';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    try {
      const userId = ctx.userClaims?.sub || ctx.userClaims?.id;
      if (!userId) throw new Error('Sesión no válida.');
      const { data: caller, error: callerError } = await ctx.supabaseAdmin
        .from('perfiles').select('rol, activo').eq('id', userId).single();
      if (callerError) throw callerError;
      if (!caller?.activo || caller.rol !== 'administrador') throw new Error('Solo un administrador puede gestionar usuarios.');

      const body = await req.json();
      const roles = ['administrador', 'supervisor', 'operador'];
      if (!roles.includes(body.rol)) throw new Error('Rol no válido.');
      if (!body.nombres?.trim() || !body.apellidos?.trim() || !body.unidad?.trim()) throw new Error('Complete los datos obligatorios.');

      if (body.accion === 'crear') {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('El nombre de usuario no es válido.');
        if (String(body.contrasena || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const { data: created, error: authError } = await ctx.supabaseAdmin.auth.admin.createUser({
          email: `${usuario}@mejia.local`, password: body.contrasena, email_confirm: true
        });
        if (authError) throw authError;
        const { error: profileError } = await ctx.supabaseAdmin.from('perfiles').insert({
          id: created.user.id, usuario, nombres: body.nombres.trim(), apellidos: body.apellidos.trim(),
          unidad: body.unidad.trim().toUpperCase(), rol: body.rol, activo: true
        });
        if (profileError) {
          await ctx.supabaseAdmin.auth.admin.deleteUser(created.user.id);
          throw profileError;
        }
      } else if (body.accion === 'actualizar') {
        if (!body.id) throw new Error('Usuario no identificado.');
        if (body.id === userId && (body.rol !== 'administrador' || body.activo === false)) throw new Error('No puede quitarse su propio acceso de administrador.');
        const { error: profileError } = await ctx.supabaseAdmin.from('perfiles').update({
          nombres: body.nombres.trim(), apellidos: body.apellidos.trim(), unidad: body.unidad.trim().toUpperCase(),
          rol: body.rol, activo: Boolean(body.activo)
        }).eq('id', body.id);
        if (profileError) throw profileError;
        if (body.contrasena) {
          if (String(body.contrasena).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
          const { error: passwordError } = await ctx.supabaseAdmin.auth.admin.updateUserById(body.id, { password: body.contrasena });
          if (passwordError) throw passwordError;
        }
      } else {
        throw new Error('Acción no válida.');
      }
      return Response.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : JSON.stringify(error);
      console.error('Error al administrar usuario:', error);
      return Response.json({ ok: false, error: message || 'Error inesperado.' }, { status: 400 });
    }
  }),
};
