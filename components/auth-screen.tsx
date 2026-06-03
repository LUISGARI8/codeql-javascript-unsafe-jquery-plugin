"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { User, DB } from "@/lib/store"
import { generateId, saveDB } from "@/lib/store"

interface AuthScreenProps {
  db: DB
  setDb: (db: DB) => void
  onLogin: (user: User) => void
  toast: (message: string, type?: string) => void
}

export function AuthScreen({ db, setDb, onLogin, toast }: AuthScreenProps) {
  const [authTab, setAuthTab] = useState<"login" | "register">("login")
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPass, setLoginPass] = useState("")
  const [regRole, setRegRole] = useState<"buyer" | "vendor">("buyer")
  const [regName, setRegName] = useState("")
  const [regEmail, setRegEmail] = useState("")
  const [regPass, setRegPass] = useState("")

  const handleLogin = () => {
    const user = db.users.find((u) => u.email === loginEmail && u.pass === loginPass)
    if (!user) {
      toast("Credenciales inválidas", "warning")
      return
    }
    onLogin(user)
    toast(`Bienvenido, ${user.name}`, "success")
  }

  const handleRegister = () => {
    if (!regName || !regEmail || !regPass) {
      toast("Complete todos los campos", "warning")
      return
    }
    if (regPass.length < 6) {
      toast("La contraseña debe tener al menos 6 caracteres", "warning")
      return
    }
    if (db.users.find((u) => u.email === regEmail)) {
      toast("Este correo ya está registrado", "warning")
      return
    }

    const newUser: User = {
      id: generateId(),
      role: regRole,
      name: regName,
      email: regEmail,
      pass: regPass,
    }

    const newDb = { ...db, users: [...db.users, newUser] }
    setDb(newDb)
    saveDB(newDb)
    toast("Cuenta creada. Inicie sesión.", "success")
    setAuthTab("login")
    setRegName("")
    setRegEmail("")
    setRegPass("")
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-center text-primary">Acceso a Plataforma</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-6">
          <Button
            variant={authTab === "login" ? "default" : "outline"}
            className={cn("flex-1", authTab === "login" && "bg-primary text-primary-foreground")}
            onClick={() => setAuthTab("login")}
          >
            Iniciar Sesión
          </Button>
          <Button
            variant={authTab === "register" ? "default" : "outline"}
            className={cn("flex-1", authTab === "register" && "bg-primary text-primary-foreground")}
            onClick={() => setAuthTab("register")}
          >
            Registrarse
          </Button>
        </div>

        {authTab === "login" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">Correo electrónico</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="tu@email.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-pass">Contraseña</Label>
              <Input
                id="login-pass"
                type="password"
                placeholder="••••••••"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
              />
            </div>
            <Button className="w-full bg-primary text-primary-foreground" onClick={handleLogin}>
              Entrar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reg-role">Tipo de Usuario</Label>
              <Select value={regRole} onValueChange={(v) => setRegRole(v as "buyer" | "vendor")}>
                <SelectTrigger id="reg-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buyer">Comprador</SelectItem>
                  <SelectItem value="vendor">Vendedor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-name">Nombre completo</Label>
              <Input
                id="reg-name"
                type="text"
                placeholder="Nombre y apellidos"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-email">Correo electrónico</Label>
              <Input
                id="reg-email"
                type="email"
                placeholder="tu@email.com"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-pass">Contraseña</Label>
              <Input
                id="reg-pass"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
              />
            </div>
            <Button
              className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90"
              onClick={handleRegister}
            >
              Crear Cuenta
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
