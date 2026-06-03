"use client"

import { useState, useEffect } from "react"
import { AuthScreen } from "@/components/auth-screen"
import { VendorPanel } from "@/components/vendor-panel"
import { BuyerPanel } from "@/components/buyer-panel"
import { loadDB, type User, type DB } from "@/lib/store"

export default function Home() {
  const [db, setDb] = useState<DB>({
    users: [],
    vendors: [],
    products: [],
    orders: [],
    cart: [],
    promotions: [],
    documents: [],
  })
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [toastMessage, setToastMessage] = useState("")
  const [toastType, setToastType] = useState("")
  const [showToast, setShowToast] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const loadedDb = loadDB()
    setDb(loadedDb)
    setMounted(true)
  }, [])

  const toast = (message: string, type: string = "") => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }

  const handleLogin = (user: User) => {
    setCurrentUser(user)
  }

  const handleLogout = () => {
    setCurrentUser(null)
  }

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-4xl mb-4">📦</div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="text-center flex-1">
              <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
                📦 <span className="text-secondary">Cavita Express</span> Cool Beer
              </h1>
              <p className="text-sm opacity-80">
                Marketplace de licores y bebidas | Intermediación tecnológica
              </p>
            </div>
            {currentUser && (
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  Hola, <strong>{currentUser.name}</strong>
                </span>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 bg-secondary text-secondary-foreground rounded-lg text-sm font-semibold hover:bg-secondary/90 transition-colors"
                >
                  Salir
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {!currentUser ? (
          <AuthScreen db={db} setDb={setDb} onLogin={handleLogin} toast={toast} />
        ) : currentUser.role === "vendor" ? (
          <VendorPanel currentUser={currentUser} db={db} setDb={setDb} toast={toast} />
        ) : (
          <BuyerPanel currentUser={currentUser} db={db} setDb={setDb} toast={toast} />
        )}
      </main>

      {/* Toast */}
      <div
        className={`fixed bottom-5 right-5 px-6 py-4 rounded-lg shadow-lg transition-all duration-300 z-[2000] ${
          showToast ? "opacity-100 translate-y-[-10px]" : "opacity-0 translate-y-0 pointer-events-none"
        } ${
          toastType === "success"
            ? "bg-success text-success-foreground"
            : toastType === "warning"
              ? "bg-warning text-warning-foreground"
              : "bg-primary text-primary-foreground"
        }`}
      >
        {toastMessage}
      </div>
    </div>
  )
}
