"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { User, Vendor, Product, CartItem, Order, DB } from "@/lib/store"
import { generateId, saveDB, createInvoiceDocument } from "@/lib/store"

interface BuyerPanelProps {
  currentUser: User
  db: DB
  setDb: (db: DB) => void
  toast: (message: string, type?: string) => void
}

export function BuyerPanel({ currentUser, db, setDb, toast }: BuyerPanelProps) {
  const [view, setView] = useState<"search" | "store" | "cart">("search")
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)

  // Search filters
  const [fDept, setFDept] = useState("")
  const [fMuni, setFMuni] = useState("")
  const [fBarrio, setFBarrio] = useState("")

  // Checkout modal
  const [showQrModal, setShowQrModal] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceText, setInvoiceText] = useState("")

  const filterVendors = () => {
    const dept = fDept.toLowerCase()
    const muni = fMuni.toLowerCase()
    const barr = fBarrio.toLowerCase()

    return db.vendors.filter(
      (v) =>
        (!dept || v.department.toLowerCase().includes(dept)) &&
        (!muni || v.municipality.toLowerCase().includes(muni)) &&
        (!barr || v.barrio.toLowerCase().includes(barr))
    )
  }

  const filteredVendors = filterVendors()

  const openStore = (vendor: Vendor) => {
    setSelectedVendor(vendor)
    setView("store")
  }

  const vendorProducts = selectedVendor
    ? db.products.filter((p) => p.vendorId === selectedVendor.userId)
    : []

  const addToCart = (product: Product) => {
    if (product.stock < 1) {
      toast("Sin stock", "warning")
      return
    }

    const newCart = [...db.cart]
    const exists = newCart.find((c) => c.productId === product.id)

    if (exists) {
      if (exists.qty >= product.stock) {
        toast("Stock insuficiente", "warning")
        return
      }
      exists.qty++
    } else {
      newCart.push({
        productId: product.id,
        vendorId: product.vendorId,
        qty: 1,
        name: product.name,
        price: product.price,
      })
    }

    const newDb = { ...db, cart: newCart }
    setDb(newDb)
    saveDB(newDb)
    toast("Agregado al carrito", "success")
  }

  const removeFromCart = (productId: string) => {
    const item = db.cart.find((c) => c.productId === productId)
    if (!item) return

    if (confirm(`¿Eliminar "${item.name}" del carrito?`)) {
      const newDb = { ...db, cart: db.cart.filter((c) => c.productId !== productId) }
      setDb(newDb)
      saveDB(newDb)
      toast(`"${item.name}" eliminado del carrito`)
    }
  }

  const increaseQty = (productId: string) => {
    const item = db.cart.find((c) => c.productId === productId)
    const product = db.products.find((p) => p.id === productId)
    if (!item || !product) return

    if (item.qty >= product.stock) {
      toast("No hay más stock disponible", "warning")
      return
    }

    const newCart = db.cart.map((c) => (c.productId === productId ? { ...c, qty: c.qty + 1 } : c))
    const newDb = { ...db, cart: newCart }
    setDb(newDb)
    saveDB(newDb)
  }

  const decreaseQty = (productId: string) => {
    const item = db.cart.find((c) => c.productId === productId)
    if (!item || item.qty <= 1) return

    const newCart = db.cart.map((c) => (c.productId === productId ? { ...c, qty: c.qty - 1 } : c))
    const newDb = { ...db, cart: newCart }
    setDb(newDb)
    saveDB(newDb)
  }

  const clearCart = () => {
    if (db.cart.length === 0) return
    if (confirm(`¿Está seguro de vaciar todo el carrito? Se eliminarán ${db.cart.length} producto(s).`)) {
      const newDb = { ...db, cart: [] }
      setDb(newDb)
      saveDB(newDb)
      toast("Carrito vaciado")
    }
  }

  const cartTotal = db.cart.reduce((a, c) => a + c.price * c.qty, 0)

  const openCheckout = () => {
    if (db.cart.length === 0) {
      toast("Carrito vacío", "warning")
      return
    }
    const vid = db.cart[0].vendorId
    const v = db.vendors.find((x) => x.userId === vid)
    if (!v) {
      toast("Vendedor no encontrado", "warning")
      return
    }
    if (!v.isOpen) {
      toast("Tienda cerrada", "warning")
      return
    }
    setSelectedVendor(v)
    setShowQrModal(true)
  }

  const confirmPayment = () => {
    setShowQrModal(false)
    const total = db.cart.reduce((a, c) => a + c.price * c.qty, 0)
    const vendorId = db.cart[0].vendorId
    const vendor = db.vendors.find((v) => v.userId === vendorId)

    const order: Order = {
      id: generateId(),
      buyerId: currentUser.id,
      buyerName: currentUser.name,
      buyerEmail: currentUser.email,
      vendorId: vendorId,
      total: total,
      status: "PAGADO",
      date: new Date().toISOString(),
      items: db.cart.map((c) => ({
        productId: c.productId,
        name: c.name,
        price: c.price,
        qty: c.qty,
      })),
    }

    const doc = createInvoiceDocument(order, db.vendors, db.documents)

    // Update product stock
    const newProducts = db.products.map((p) => {
      const cartItem = db.cart.find((c) => c.productId === p.id)
      if (cartItem) {
        return { ...p, stock: p.stock - cartItem.qty }
      }
      return p
    })

    const newDb = {
      ...db,
      orders: [...db.orders, order],
      documents: [...db.documents, doc],
      products: newProducts,
      cart: [],
    }

    setDb(newDb)
    saveDB(newDb)

    const invText = `FACTURA DE VENTA
================
N° ${doc.number}
Fecha: ${new Date().toLocaleString("es-CO")}
CUFE: ${doc.cufe}

VENDEDOR:
${vendor?.businessName || "Tienda"}
${vendor?.department}, ${vendor?.municipality}

COMPRADOR:
${currentUser.name}
${currentUser.email}

PRODUCTOS:
${order.items.map((i) => `- ${i.name} x${i.qty} = $${(i.price * i.qty).toLocaleString("es-CO")}`).join("\n")}

Subtotal: $${doc.subtotal.toLocaleString("es-CO")}
IVA (19%): $${doc.iva.toLocaleString("es-CO")}
TOTAL PAGADO: $${total.toLocaleString("es-CO")}

Estado: ✅ PAGADO
Método: Nequi QR

[Documento generado con fines demostrativos]`

    setInvoiceText(invText)
    setShowInvoiceModal(true)
    toast("Pago confirmado. Factura generada.", "success")
    setView("search")
  }

  // Search View
  if (view === "search") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-primary">🔍 Buscar Tiendas de Licores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Departamento</Label>
                <Input
                  placeholder="Ej: Antioquia"
                  value={fDept}
                  onChange={(e) => setFDept(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Municipio</Label>
                <Input
                  placeholder="Ej: Medellín"
                  value={fMuni}
                  onChange={(e) => setFMuni(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Barrio</Label>
                <Input
                  placeholder="Ej: Laureles"
                  value={fBarrio}
                  onChange={(e) => setFBarrio(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cart button */}
        {db.cart.length > 0 && (
          <Card className="bg-gradient-to-r from-primary to-[#1a3a5c] text-primary-foreground">
            <CardContent className="p-4 flex items-center justify-between flex-wrap gap-4">
              <div>
                <span className="font-semibold">🛒 Tienes {db.cart.length} producto(s) en el carrito</span>
                <span className="block text-secondary font-bold text-lg">
                  Total: ${cartTotal.toLocaleString("es-CO")}
                </span>
              </div>
              <Button
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
                onClick={() => setView("cart")}
              >
                Ver Carrito
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Vendor List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVendors.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="p-8 text-center text-muted-foreground">
                No hay tiendas disponibles con esos filtros.
              </CardContent>
            </Card>
          ) : (
            filteredVendors.map((v) => (
              <Card key={v.userId}>
                <CardContent className="p-4">
                  <h3 className="font-bold text-primary text-lg">{v.businessName || "Tienda"}</h3>
                  <p className="text-muted-foreground text-sm my-2">
                    📍 {v.department}, {v.municipality}, {v.barrio}
                    <br />
                    🏠 {v.address || "N/A"}
                  </p>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      v.isOpen
                        ? "bg-green-100 text-success border border-success"
                        : "bg-red-100 text-destructive border border-destructive"
                    }`}
                  >
                    {v.isOpen ? "🟢 ABIERTO" : "🔴 CERRADO"}
                  </span>
                  <Button
                    className="w-full mt-4 bg-primary text-primary-foreground"
                    onClick={() => openStore(v)}
                  >
                    🛒 Ver Productos
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    )
  }

  // Store View
  if (view === "store" && selectedVendor) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-4">
            <Button className="mb-4" variant="outline" onClick={() => setView("search")}>
              ← Volver
            </Button>
            <h2 className="text-xl font-bold text-primary">🏪 {selectedVendor.businessName || "Tienda"}</h2>
            <p className="text-muted-foreground">
              📍 {selectedVendor.department}, {selectedVendor.municipality} |{" "}
              <span
                className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  selectedVendor.isOpen
                    ? "bg-green-100 text-success"
                    : "bg-red-100 text-destructive"
                }`}
              >
                {selectedVendor.isOpen ? "Abierto" : "Cerrado"}
              </span>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {vendorProducts.length === 0 ? (
                <p className="col-span-full text-center p-8 text-muted-foreground">Sin productos</p>
              ) : (
                vendorProducts.map((p) => (
                  <Card key={p.id}>
                    <CardContent className="p-4">
                      <h4 className="font-bold text-primary">{p.name}</h4>
                      <p className="text-muted-foreground text-sm">{p.category}</p>
                      <p className="text-xl font-bold text-success my-2">
                        ${p.price.toLocaleString("es-CO")}
                      </p>
                      <p className={`text-sm ${p.stock > 5 ? "text-success" : "text-warning"}`}>
                        Stock: {p.stock}
                      </p>
                      <Button
                        className="w-full mt-3 bg-secondary text-secondary-foreground hover:bg-secondary/90"
                        disabled={p.stock < 1}
                        onClick={() => addToCart(p)}
                      >
                        {p.stock > 0 ? "🛒 Agregar" : "❌ Agotado"}
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            <Button
              className="w-full mt-6 bg-success text-success-foreground hover:bg-success/90 py-4"
              onClick={() => setView("cart")}
            >
              🛒 Ver Carrito ({db.cart.length} productos)
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Cart View
  if (view === "cart") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-primary">🛒 Carrito de Compras</CardTitle>
            <div className="flex items-center gap-4">
              <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm font-semibold">
                {db.cart.length} producto{db.cart.length !== 1 ? "s" : ""}
              </span>
              {db.cart.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive hover:bg-destructive/10"
                  onClick={clearCart}
                >
                  🗑️ Vaciar Carrito
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {db.cart.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4 opacity-30">🛒</div>
                <p className="text-muted-foreground font-semibold">Tu carrito está vacío</p>
                <p className="text-muted-foreground text-sm">
                  Agrega productos de las tiendas para comenzar
                </p>
                <Button className="mt-4" onClick={() => setView("search")}>
                  🔍 Buscar Tiendas
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {db.cart.map((item) => {
                    const product = db.products.find((p) => p.id === item.productId)
                    const maxStock = product?.stock || 999
                    const subtotal = item.price * item.qty

                    return (
                      <div
                        key={item.productId}
                        className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 p-4 bg-muted rounded-lg border-l-4 border-l-primary"
                      >
                        <div>
                          <div className="font-semibold text-primary">{item.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {product?.category || ""} | Stock disponible: {maxStock}
                          </div>
                        </div>
                        <div className="font-bold text-primary text-lg">
                          ${item.price.toLocaleString("es-CO")}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 w-9 p-0 bg-orange-50 text-warning border-warning hover:bg-warning hover:text-white"
                            disabled={item.qty <= 1}
                            onClick={() => decreaseQty(item.productId)}
                          >
                            −
                          </Button>
                          <span className="w-10 text-center font-bold text-lg">{item.qty}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 w-9 p-0 bg-green-50 text-success border-success hover:bg-success hover:text-white"
                            disabled={item.qty >= maxStock}
                            onClick={() => increaseQty(item.productId)}
                          >
                            +
                          </Button>
                        </div>
                        <div className="font-bold text-success text-lg min-w-[100px] text-right">
                          ${subtotal.toLocaleString("es-CO")}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-9 p-0 bg-red-50 text-destructive border-destructive hover:bg-destructive hover:text-white"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          🗑️
                        </Button>
                      </div>
                    )
                  })}
                </div>

                <div className="flex justify-between items-center p-6 bg-gradient-to-r from-primary to-[#1a3a5c] text-primary-foreground rounded-xl mt-6">
                  <h3 className="text-lg font-semibold">Total a Pagar:</h3>
                  <span className="text-3xl font-bold text-secondary">
                    ${cartTotal.toLocaleString("es-CO")}
                  </span>
                </div>

                <div className="flex gap-4 mt-4 flex-wrap">
                  <Button
                    className="flex-1 min-w-[200px] py-4 bg-success text-success-foreground hover:bg-success/90"
                    onClick={openCheckout}
                  >
                    💳 Proceder al Pago con Nequi
                  </Button>
                  <Button
                    className="flex-1 min-w-[200px] py-4"
                    variant="outline"
                    onClick={() => setView("search")}
                  >
                    ← Seguir Comprando
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* QR Modal */}
        {showQrModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <Card className="max-w-md w-full max-h-[90vh] overflow-y-auto">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold text-primary mb-4">📱 Pago con Nequi</h3>
                <p className="mb-4">Escanea el código QR del vendedor con tu app Nequi</p>

                <div className="w-[250px] h-[250px] mx-auto bg-muted border-3 border-dashed border-secondary rounded-xl flex items-center justify-center overflow-hidden">
                  {selectedVendor?.qrUrl ? (
                    <img
                      src={selectedVendor.qrUrl}
                      alt="QR Nequi"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-muted-foreground text-center">QR no disponible</div>
                  )}
                </div>

                <div className="bg-amber-50 p-4 rounded-lg mt-4 text-left text-sm">
                  <strong>Instrucciones:</strong>
                  <ol className="list-decimal ml-5 mt-2 space-y-1">
                    <li>Abre Nequi en tu celular</li>
                    <li>Selecciona &quot;Pagar con QR&quot;</li>
                    <li>Escanea el código mostrado</li>
                    <li>Confirma el monto exacto</li>
                    <li>Regresa a la app y confirma</li>
                  </ol>
                </div>

                <Button
                  className="w-full mt-4 py-4 bg-success text-success-foreground hover:bg-success/90"
                  onClick={confirmPayment}
                >
                  ✅ Ya realicé el pago
                </Button>
                <Button
                  variant="destructive"
                  className="w-full mt-2"
                  onClick={() => setShowQrModal(false)}
                >
                  Cancelar
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Invoice Modal */}
        {showInvoiceModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <Card className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <CardContent className="p-6">
                <div className="bg-success text-success-foreground p-4 rounded-lg mb-4">
                  <h3 className="font-bold text-lg">✅ ¡Pago Exitoso!</h3>
                </div>
                <h4 className="text-primary font-bold mb-4">📄 Factura de Venta</h4>
                <div className="bg-muted p-4 rounded-lg font-mono text-sm whitespace-pre-wrap">
                  {invoiceText}
                </div>
                <p className="text-sm text-muted-foreground mt-4 p-3 bg-blue-50 rounded-lg">
                  📧 Se ha enviado una copia al correo electrónico registrado.
                </p>
                <Button
                  className="w-full mt-4"
                  onClick={() => setShowInvoiceModal(false)}
                >
                  Cerrar
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    )
  }

  return null
}
