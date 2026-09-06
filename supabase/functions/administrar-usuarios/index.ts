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
      if (body.accion === 'eliminar') {
        if (!body.id) throw new Error('Usuario no identificado.');
        if (body.id === userId) throw new Error('No puede eliminar su propia cuenta.');
        const { data: target, error: targetError } = await ctx.supabaseAdmin.from('perfiles').select('rol,nombres,apellidos').eq('id', body.id).single();
        if (targetError) throw targetError;
        if (target.rol === 'administrador') {
          const { count, error: countError } = await ctx.supabaseAdmin.from('perfiles').select('id', { count: 'exact', head: true }).eq('rol', 'administrador').eq('activo', true);
          if (countError) throw countError;
          if ((count || 0) <= 1) throw new Error('Debe conservar al menos un administrador activo.');
        }
        const activityChecks = await Promise.all([
          ctx.supabaseAdmin.from('fichas').select('id', { count: 'exact', head: true }).eq('creado_por', body.id),
          ctx.supabaseAdmin.from('personas').select('id', { count: 'exact', head: true }).eq('creado_por', body.id),
          ctx.supabaseAdmin.from('detenciones').select('id', { count: 'exact', head: true }).eq('creado_por', body.id)
        ]);
        if (activityChecks.some(result => result.error)) throw activityChecks.find(result => result.error)?.error;
        if (activityChecks.some(result => (result.count || 0) > 0)) throw new Error('Este usuario tiene registros históricos. Por seguridad y auditoría, desactívelo en lugar de eliminarlo.');
        const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(body.id);
        if (deleteError) throw deleteError;
        await ctx.supabaseAdmin.from('perfiles').delete().eq('id', body.id);
        return Response.json({ ok: true });
      }
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
