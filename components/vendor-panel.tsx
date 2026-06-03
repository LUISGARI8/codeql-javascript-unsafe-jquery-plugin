"use client"

import { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { User, Vendor, Product, Order, Document as DocType, DB } from "@/lib/store"
import { generateId, saveDB, createInvoiceDocument } from "@/lib/store"

interface VendorPanelProps {
  currentUser: User
  db: DB
  setDb: (db: DB) => void
  toast: (message: string, type?: string) => void
}

export function VendorPanel({ currentUser, db, setDb, toast }: VendorPanelProps) {
  const [businessName, setBusinessName] = useState("")
  const [idType, setIdType] = useState<"NIT" | "CEDULA">("NIT")
  const [idNumber, setIdNumber] = useState("")
  const [department, setDepartment] = useState("")
  const [municipality, setMunicipality] = useState("")
  const [barrio, setBarrio] = useState("")
  const [address, setAddress] = useState("")
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const qrInputRef = useRef<HTMLInputElement>(null)

  // Product form
  const [pName, setPName] = useState("")
  const [pPrice, setPPrice] = useState("")
  const [pStock, setPStock] = useState("")
  const [pCat, setPCat] = useState("Cavitas")

  // Document filters
  const [docTypeFilter, setDocTypeFilter] = useState("all")
  const [docSearch, setDocSearch] = useState("")

  // Customer selection for promotions
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set())

  // Expanded orders to show details
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())

  // Load vendor data on mount
  useEffect(() => {
    const vendor = db.vendors.find((v) => v.userId === currentUser.id)
    if (vendor) {
      setBusinessName(vendor.businessName || "")
      setIdType(vendor.idType || "NIT")
      setIdNumber(vendor.idNumber || "")
      setDepartment(vendor.department || "")
      setMunicipality(vendor.municipality || "")
      setBarrio(vendor.barrio || "")
      setAddress(vendor.address || "")
      setQrUrl(vendor.qrUrl)
      setIsOpen(vendor.isOpen)
    }
  }, [currentUser.id, db.vendors])

  const handleQrUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast("Selecciona un archivo de imagen válido", "warning")
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("La imagen no debe superar 2MB", "warning")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      setQrUrl(e.target?.result as string)
      toast("QR cargado correctamente", "success")
    }
    reader.readAsDataURL(file)
  }

  const removeQr = () => {
    setQrUrl(null)
    if (qrInputRef.current) qrInputRef.current.value = ""
    toast("QR eliminado")
  }

  const saveVendorProfile = () => {
    const vendorData: Vendor = {
      userId: currentUser.id,
      businessName,
      idType,
      idNumber,
      department,
      municipality,
      barrio,
      address,
      qrUrl,
      isOpen,
    }

    const idx = db.vendors.findIndex((v) => v.userId === currentUser.id)
    let newVendors: Vendor[]
    if (idx >= 0) {
      newVendors = [...db.vendors]
      newVendors[idx] = vendorData
    } else {
      newVendors = [...db.vendors, vendorData]
    }

    const newDb = { ...db, vendors: newVendors }
    setDb(newDb)
    saveDB(newDb)
    toast("Perfil de negocio guardado correctamente", "success")
  }

  const addProduct = () => {
    const name = pName.trim()
    const price = Number(pPrice)
    const stock = Number(pStock)

    if (!name || !price || !stock) {
      toast("Complete todos los datos del producto", "warning")
      return
    }
    if (price <= 0 || stock < 0) {
      toast("Precio y stock deben ser mayores a 0", "warning")
      return
    }

    const exists = db.products.find(
      (p) => p.vendorId === currentUser.id && p.name.toLowerCase() === name.toLowerCase()
    )

    if (exists) {
      if (!confirm(`Ya existe: "${exists.name}". ¿Actualizar stock?`)) return
      const newProducts = db.products.map((p) =>
        p.id === exists.id ? { ...p, price, stock: p.stock + stock } : p
      )
      const newDb = { ...db, products: newProducts }
      setDb(newDb)
      saveDB(newDb)
      toast("Producto actualizado", "success")
      setPName("")
      setPPrice("")
      setPStock("")
      return
    }

    const newProduct: Product = {
      id: generateId(),
      vendorId: currentUser.id,
      name,
      price,
      stock,
      category: pCat,
      createdAt: new Date().toISOString(),
    }

    const newDb = { ...db, products: [...db.products, newProduct] }
    setDb(newDb)
    saveDB(newDb)
    toast("Producto agregado", "success")
    setPName("")
    setPPrice("")
    setPStock("")
  }

  const deleteProduct = (productId: string) => {
    if (!confirm("¿Eliminar este producto?")) return
    const newDb = { ...db, products: db.products.filter((p) => p.id !== productId) }
    setDb(newDb)
    saveDB(newDb)
    toast("Producto eliminado")
  }

  const detectAndRemoveDuplicates = () => {
    const myProducts = db.products.filter((p) => p.vendorId === currentUser.id)
    const seen = new Map<string, Product>()
    const duplicates: { original: Product; duplicate: Product }[] = []

    myProducts.forEach((p) => {
      const key = p.name.toLowerCase().trim()
      if (seen.has(key)) {
        duplicates.push({ original: seen.get(key)!, duplicate: p })
      } else {
        seen.set(key, p)
      }
    })

    if (duplicates.length === 0) {
      toast("No se encontraron duplicados", "success")
      return
    }

    if (!confirm(`Se encontraron ${duplicates.length} duplicados. ¿Eliminarlos?`)) return

    let newProducts = [...db.products]
    duplicates.forEach((d) => {
      const keep = d.original.stock >= d.duplicate.stock ? d.original : d.duplicate
      const remove = d.original === keep ? d.duplicate : d.original
      newProducts = newProducts.map((p) => (p.id === keep.id ? { ...p, stock: p.stock + remove.stock } : p))
      newProducts = newProducts.filter((p) => p.id !== remove.id)
    })

    const newDb = { ...db, products: newProducts }
    setDb(newDb)
    saveDB(newDb)
    toast(`${duplicates.length} duplicados eliminados`, "success")
  }

  const myProducts = db.products.filter((p) => p.vendorId === currentUser.id)
  const mySales = db.orders.filter((o) => o.vendorId === currentUser.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  const myDocs = db.documents.filter((d) => d.vendorId === currentUser.id)

  // Stats
  const totalSales = mySales.reduce((a, o) => a + o.total, 0)

  // Alerts
  const alerts = myProducts
    .filter((p) => p.stock <= 3)
    .map((p) => ({
      type: p.stock === 0 ? "critical" : "warning",
      icon: p.stock === 0 ? "🔴" : "⚠️",
      title: p.stock === 0 ? `${p.name} - AGOTADO` : `${p.name} - STOCK BAJO (${p.stock})`,
      message: p.stock === 0 ? "Producto sin stock." : "Reabastecer pronto.",
    }))

  // Recurrent customers
  const customerMap = new Map<
    string,
    {
      id: string
      name: string
      email: string
      totalOrders: number
      totalSpent: number
      lastPurchase: string
      products: string[]
    }
  >()

  mySales.forEach((order) => {
    if (!customerMap.has(order.buyerId)) {
      customerMap.set(order.buyerId, {
        id: order.buyerId,
        name: order.buyerName,
        email: order.buyerEmail || "",
        totalOrders: 0,
        totalSpent: 0,
        lastPurchase: order.date,
        products: [],
      })
    }
    const c = customerMap.get(order.buyerId)!
    c.totalOrders++
    c.totalSpent += order.total
    if (order.date > c.lastPurchase) c.lastPurchase = order.date
    if (order.items) {
      order.items.forEach((i) => {
        if (!c.products.includes(i.name)) c.products.push(i.name)
      })
    }
  })

  const recurrentCustomers = Array.from(customerMap.values())
    .filter((c) => c.totalOrders >= 2)
    .sort((a, b) => b.totalOrders - a.totalOrders)

  const toggleCustomer = (id: string) => {
    const newSet = new Set(selectedCustomers)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedCustomers(newSet)
  }

  const sendPromotions = () => {
    if (selectedCustomers.size === 0) {
      toast("Seleccione al menos un cliente", "warning")
      return
    }
    toast(`Promoción enviada a ${selectedCustomers.size} clientes`, "success")
    setSelectedCustomers(new Set())
  }

  const toggleOrderExpand = (orderId: string) => {
    const newSet = new Set(expandedOrders)
    if (newSet.has(orderId)) {
      newSet.delete(orderId)
    } else {
      newSet.add(orderId)
    }
    setExpandedOrders(newSet)
  }

  // Document filtering
  let filteredDocs = myDocs
  if (docTypeFilter !== "all") {
    filteredDocs = filteredDocs.filter((d) => d.type === docTypeFilter)
  }
  if (docSearch) {
    filteredDocs = filteredDocs.filter(
      (d) =>
        d.number.toLowerCase().includes(docSearch.toLowerCase()) ||
        d.buyer.name.toLowerCase().includes(docSearch.toLowerCase())
    )
  }

  const downloadAllDocsCSV = () => {
    if (myDocs.length === 0) {
      toast("No hay documentos para exportar", "warning")
      return
    }
    let csv = "TIPO,NUMERO,FECHA,CLIENTE,EMAIL,SUBTOTAL,IVA,TOTAL,CUFE,ESTADO,METODO_PAGO\n"
    myDocs.forEach((doc) => {
      csv += `${doc.type},${doc.number},${new Date(doc.date).toLocaleString("es-CO")},${doc.buyer.name},${doc.buyer.email || ""},${doc.subtotal},${doc.iva},${doc.total},${doc.cufe},${doc.status},${doc.paymentMethod}\n`
    })
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cavita_express_documentos_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(`${myDocs.length} documentos exportados a CSV`, "success")
  }

  // Duplicate count
  const seen = new Map<string, Product>()
  let dupCount = 0
  myProducts.forEach((p) => {
    const key = p.name.toLowerCase().trim()
    if (seen.has(key)) dupCount++
    else seen.set(key, p)
  })

  return (
    <div className="space-y-6">
      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Card className="border-l-4 border-l-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              🚨 Alertas de Inventario
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert, i) => (
              <div
                key={i}
                className={`p-3 rounded-md flex items-center gap-3 ${
                  alert.type === "critical" ? "bg-red-50 border-l-4 border-l-destructive" : "bg-orange-50 border-l-4 border-l-warning"
                }`}
              >
                <span className="text-xl">{alert.icon}</span>
                <div>
                  <strong className="block">{alert.title}</strong>
                  <small className="text-muted-foreground">{alert.message}</small>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-primary to-[#1a3a5c] text-primary-foreground p-4 rounded-xl text-center">
          <h3 className="text-2xl font-bold">{myProducts.length}</h3>
          <p className="text-sm opacity-90">Productos</p>
        </div>
        <div className="bg-gradient-to-br from-secondary to-[#a88420] text-secondary-foreground p-4 rounded-xl text-center">
          <h3 className="text-2xl font-bold">${totalSales.toLocaleString("es-CO")}</h3>
          <p className="text-sm opacity-90">Ventas Totales</p>
        </div>
        <div className="bg-gradient-to-br from-primary to-[#1a3a5c] text-primary-foreground p-4 rounded-xl text-center">
          <h3 className="text-2xl font-bold">{mySales.length}</h3>
          <p className="text-sm opacity-90">Pedidos</p>
        </div>
        <div className="bg-gradient-to-br from-secondary to-[#a88420] text-secondary-foreground p-4 rounded-xl text-center">
          <h3 className="text-2xl font-bold">{myDocs.length}</h3>
          <p className="text-sm opacity-90">Documentos</p>
        </div>
      </div>

      {/* Business Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-primary">📋 Perfil de Negocio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre del negocio</Label>
              <Input
                placeholder="Ej: Licorera El Descanso"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Identificación</Label>
              <Select value={idType} onValueChange={(v) => setIdType(v as "NIT" | "CEDULA")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NIT">NIT</SelectItem>
                  <SelectItem value="CEDULA">Cédula</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Número de Identificación</Label>
              <Input
                placeholder="NIT o Cédula"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Departamento</Label>
              <Input
                placeholder="Ej: Antioquia"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Municipio</Label>
              <Input
                placeholder="Ej: Medellín"
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Barrio</Label>
              <Input
                placeholder="Ej: El Poblado"
                value={barrio}
                onChange={(e) => setBarrio(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Dirección exacta</Label>
            <Input
              placeholder="Calle, carrera, número, referencia"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          {/* QR Upload */}
          <div className="space-y-2">
            <Label>📱 QR de Nequi para pagos</Label>
            <div
              className="p-8 text-center bg-muted border-2 border-dashed border-primary rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
              onClick={() => qrInputRef.current?.click()}
            >
              <div className="text-4xl mb-2">📷</div>
              <div className="font-semibold text-primary">Click para subir imagen del QR</div>
              <div className="text-sm text-muted-foreground mt-1">Formatos: JPG, PNG (Máx 2MB)</div>
            </div>
            <input
              ref={qrInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleQrUpload}
            />
            {qrUrl && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="font-semibold mb-2 text-primary">Vista previa del QR:</div>
                <img
                  src={qrUrl}
                  alt="QR Nequi"
                  className="max-w-[200px] max-h-[200px] rounded-lg border-2 border-secondary"
                />
                <Button variant="destructive" size="sm" className="mt-2" onClick={removeQr}>
                  Eliminar QR
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="vOpen" checked={isOpen} onCheckedChange={(v) => setIsOpen(!!v)} />
            <Label htmlFor="vOpen" className="cursor-pointer font-semibold">
              ✅ Negocio Abierto (visible para clientes)
            </Label>
          </div>

          <Button className="w-full bg-primary text-primary-foreground" onClick={saveVendorProfile}>
            💾 Guardar Perfil de Negocio
          </Button>
        </CardContent>
      </Card>

      {/* Add Product */}
      <Card>
        <CardHeader>
          <CardTitle className="text-primary">➕ Agregar Producto al Inventario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre del producto</Label>
              <Input
                placeholder="Ej: Cavita Corona 12 unidades"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Precio de venta (COP)</Label>
              <Input
                type="number"
                placeholder="90000"
                value={pPrice}
                onChange={(e) => setPPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stock inicial</Label>
              <Input
                type="number"
                placeholder="10"
                value={pStock}
                onChange={(e) => setPStock(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={pCat} onValueChange={setPCat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cavitas">Cavitas de cerveza</SelectItem>
                  <SelectItem value="Licores">Licores</SelectItem>
                  <SelectItem value="Bebidas/Energizantes">Bebidas/Energizantes</SelectItem>
                  <SelectItem value="Sal de frutas">Sal de frutas</SelectItem>
                  <SelectItem value="Gatorade">Gatorade</SelectItem>
                  <SelectItem value="Electrolit">Electrolit</SelectItem>
                  <SelectItem value="Otros">Otros</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90"
            onClick={addProduct}
          >
            ➕ Agregar Producto
          </Button>
        </CardContent>
      </Card>

      {/* Products Inventory */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-primary">📦 Inventario de Productos</CardTitle>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={detectAndRemoveDuplicates} className="text-warning border-warning hover:bg-warning/10">
              🔄 Limpiar Duplicados
            </Button>
            {dupCount > 0 && (
              <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded-full text-xs font-semibold">
                {dupCount} duplicados
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th className="p-3 text-left">Producto</th>
                  <th className="p-3 text-left">Categoría</th>
                  <th className="p-3 text-left">Precio</th>
                  <th className="p-3 text-left">Stock</th>
                  <th className="p-3 text-left">Estado</th>
                  <th className="p-3 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {myProducts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-muted-foreground">
                      No hay productos registrados
                    </td>
                  </tr>
                ) : (
                  myProducts.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/50">
                      <td className="p-3 font-semibold">{p.name}</td>
                      <td className="p-3">{p.category}</td>
                      <td className="p-3 font-semibold text-primary">
                        ${p.price.toLocaleString("es-CO")}
                      </td>
                      <td className={`p-3 ${p.stock <= 3 ? "text-warning" : ""}`}>
                        {p.stock === 0 ? "Agotado" : p.stock <= 3 ? `${p.stock} ⚠️` : p.stock}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            p.stock === 0
                              ? "bg-red-100 text-destructive border border-destructive"
                              : p.stock <= 3
                                ? "bg-orange-100 text-warning border border-warning"
                                : "bg-green-100 text-success border border-success"
                          }`}
                        >
                          {p.stock === 0 ? "Agotado" : p.stock <= 3 ? "Bajo" : "OK"}
                        </span>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteProduct(p.id)}
                        >
                          🗑️
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sales Table with Order Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-primary">💰 Pedidos de Clientes (Pagados)</CardTitle>
        </CardHeader>
        <CardContent>
          {mySales.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground">
              <div className="text-5xl mb-4 opacity-30">📋</div>
              <p className="font-semibold">No hay pedidos registrados</p>
              <p className="text-sm">Cuando un cliente pague, verás sus pedidos aquí</p>
            </div>
          ) : (
            <div className="space-y-4">
              {mySales.map((order) => {
                const doc = db.documents.find((d) => d.orderId === order.id)
                const isExpanded = expandedOrders.has(order.id)
                
                return (
                  <div
                    key={order.id}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Order Header - Clickable */}
                    <div
                      className="p-4 bg-muted cursor-pointer hover:bg-blue-50 transition-colors flex items-center justify-between flex-wrap gap-4"
                      onClick={() => toggleOrderExpand(order.id)}
                    >
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-2xl">{isExpanded ? "▼" : "▶"}</span>
                        <div>
                          <div className="font-mono text-sm text-muted-foreground">
                            Pedido #{order.id.slice(0, 8).toUpperCase()}
                          </div>
                          <div className="font-bold text-primary text-lg">{order.buyerName}</div>
                          <div className="text-sm text-muted-foreground">{order.buyerEmail}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 flex-wrap">
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Total</div>
                          <div className="font-bold text-success text-xl">
                            ${order.total.toLocaleString("es-CO")}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Fecha</div>
                          <div className="font-semibold text-primary">
                            {new Date(order.date).toLocaleDateString("es-CO")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(order.date).toLocaleTimeString("es-CO")}
                          </div>
                        </div>
                        <span className="px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-success border border-success">
                          {order.status}
                        </span>
                      </div>
                    </div>

                    {/* Order Details - Expandable */}
                    {isExpanded && (
                      <div className="border-t bg-card p-4">
                        <h4 className="font-bold text-primary mb-3 flex items-center gap-2">
                          <span>📦</span> Productos del Pedido ({order.items?.length || 0} items)
                        </h4>
                        
                        {/* Products Table */}
                        <div className="overflow-x-auto mb-4">
                          <table className="w-full border-collapse">
                            <thead className="bg-primary/10">
                              <tr>
                                <th className="p-3 text-left text-primary font-semibold">Producto</th>
                                <th className="p-3 text-center text-primary font-semibold">Cantidad</th>
                                <th className="p-3 text-right text-primary font-semibold">Precio Unit.</th>
                                <th className="p-3 text-right text-primary font-semibold">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.items && order.items.length > 0 ? (
                                order.items.map((item, idx) => (
                                  <tr key={idx} className="border-b hover:bg-muted/50">
                                    <td className="p-3">
                                      <div className="font-semibold">{item.name}</div>
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full font-bold">
                                        x{item.qty}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right font-semibold">
                                      ${item.price.toLocaleString("es-CO")}
                                    </td>
                                    <td className="p-3 text-right font-bold text-success">
                                      ${(item.price * item.qty).toLocaleString("es-CO")}
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={4} className="p-4 text-center text-muted-foreground">
                                    Sin detalles de productos
                                  </td>
                                </tr>
                              )}
                            </tbody>
                            <tfoot className="bg-primary/5">
                              <tr>
                                <td colSpan={3} className="p-3 text-right font-bold text-primary">
                                  TOTAL PAGADO:
                                </td>
                                <td className="p-3 text-right font-bold text-success text-lg">
                                  ${order.total.toLocaleString("es-CO")}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {/* Document Info */}
                        {doc && (
                          <div className="bg-blue-50 p-4 rounded-lg">
                            <div className="flex items-center justify-between flex-wrap gap-4">
                              <div>
                                <div className="text-sm text-muted-foreground">Factura Generada</div>
                                <div className="font-mono font-bold text-primary">{doc.number}</div>
                              </div>
                              <div>
                                <div className="text-sm text-muted-foreground">CUFE</div>
                                <div className="font-mono text-xs text-primary">{doc.cufe}</div>
                              </div>
                              <div>
                                <div className="text-sm text-muted-foreground">Método de Pago</div>
                                <div className="font-semibold text-primary">{doc.paymentMethod}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recurrent Customers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-primary">👥 Clientes Recurrentes</CardTitle>
          <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm font-semibold">
            {recurrentCustomers.length} clientes
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Clientes que han realizado 2 o más compras.
          </p>
          {recurrentCustomers.length === 0 ? (
            <p className="text-center p-8 text-muted-foreground">
              Aún no hay clientes recurrentes
            </p>
          ) : (
            <div className="space-y-2">
              {recurrentCustomers.map((c) => (
                <div
                  key={c.id}
                  className="bg-muted p-4 rounded-lg flex items-center justify-between flex-wrap gap-4"
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedCustomers.has(c.id)}
                      onCheckedChange={() => toggleCustomer(c.id)}
                    />
                    <div>
                      <h4 className="font-semibold text-primary">{c.name}</h4>
                      <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                        <span>🛒 {c.totalOrders} compras</span>
                        <span>💰 ${c.totalSpent.toLocaleString("es-CO")}</span>
                        <span>📅 Últ: {new Date(c.lastPurchase).toLocaleDateString("es-CO")}</span>
                      </div>
                      {c.products.length > 0 && (
                        <small className="text-muted-foreground">
                          Productos: {c.products.slice(0, 3).join(", ")}
                        </small>
                      )}
                    </div>
                  </div>
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded-full text-xs font-semibold">
                    {c.totalOrders}x
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button
            className="w-full mt-4 bg-success text-success-foreground hover:bg-success/90"
            disabled={selectedCustomers.size === 0}
            onClick={sendPromotions}
          >
            📧 Enviar Promoción a {selectedCustomers.size > 0 ? `${selectedCustomers.size} ` : ""}Seleccionados
          </Button>
        </CardContent>
      </Card>

      {/* Documents Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-primary">📄 Gestión de Facturas y Documentos</CardTitle>
          <Button variant="outline" size="sm" onClick={downloadAllDocsCSV}>
            📥 Descargar Todo (CSV)
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4 flex-wrap">
            <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos los tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="FACTURA_VENTA">Facturas de Venta</SelectItem>
                <SelectItem value="NOTA_CREDITO">Notas de Crédito</SelectItem>
                <SelectItem value="REMISION">Remisiones</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="🔍 Buscar por cliente o número..."
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
          </div>

          {filteredDocs.length === 0 ? (
            <p className="text-center p-8 text-muted-foreground">
              No hay documentos generados aún.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredDocs
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-muted p-4 rounded-lg border-l-4 border-l-primary hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-primary font-bold bg-blue-100 px-2 py-1 rounded">
                          {doc.type.replace("_", " ")}
                        </span>
                        <div className="font-mono font-bold text-lg text-primary mt-1">
                          {doc.number}
                        </div>
                      </div>
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-success border border-success">
                        {doc.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div className="text-sm">
                        <span className="block text-muted-foreground text-xs">Cliente</span>
                        <strong className="text-primary">{doc.buyer.name}</strong>
                      </div>
                      <div className="text-sm">
                        <span className="block text-muted-foreground text-xs">Fecha</span>
                        <strong className="text-primary">
                          {new Date(doc.date).toLocaleString("es-CO")}
                        </strong>
                      </div>
                      <div className="text-sm">
                        <span className="block text-muted-foreground text-xs">Total</span>
                        <strong className="text-success text-lg">
                          ${doc.total.toLocaleString("es-CO")}
                        </strong>
                      </div>
                      <div className="text-sm">
                        <span className="block text-muted-foreground text-xs">CUFE</span>
                        <strong className="text-primary text-xs">{doc.cufe}</strong>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
