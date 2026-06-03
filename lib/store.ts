"use client"

// Types
export interface User {
  id: string
  role: "buyer" | "vendor"
  name: string
  email: string
  pass: string
}

export interface Vendor {
  userId: string
  businessName: string
  idType: "NIT" | "CEDULA"
  idNumber: string
  department: string
  municipality: string
  barrio: string
  address: string
  qrUrl: string | null
  isOpen: boolean
}

export interface Product {
  id: string
  vendorId: string
  name: string
  price: number
  stock: number
  category: string
  createdAt: string
}

export interface CartItem {
  productId: string
  vendorId: string
  qty: number
  name: string
  price: number
}

export interface OrderItem {
  productId: string
  name: string
  price: number
  qty: number
}

export interface Order {
  id: string
  buyerId: string
  buyerName: string
  buyerEmail: string
  vendorId: string
  total: number
  status: string
  date: string
  items: OrderItem[]
}

export interface Document {
  id: string
  type: "FACTURA_VENTA" | "NOTA_CREDITO" | "REMISION"
  number: string
  orderId: string
  vendorId: string
  vendor: {
    name: string
    idType: string
    idNumber: string
    address: string
    city: string
  }
  buyer: {
    name: string
    email: string
    id: string
  }
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  date: string
  status: string
  cufe: string
  paymentMethod: string
}

export interface Promotion {
  id: string
  vendorId: string
  subject: string
  message: string
  targets: string[]
  date: string
  status: string
}

export interface DB {
  users: User[]
  vendors: Vendor[]
  products: Product[]
  orders: Order[]
  cart: CartItem[]
  promotions: Promotion[]
  documents: Document[]
}

// Helper to get storage safely
const getStorage = () => {
  if (typeof window !== "undefined") {
    return window.localStorage
  }
  return null
}

// Load data from localStorage
export const loadDB = (): DB => {
  const storage = getStorage()
  if (!storage) {
    return {
      users: [],
      vendors: [],
      products: [],
      orders: [],
      cart: [],
      promotions: [],
      documents: [],
    }
  }

  return {
    users: JSON.parse(storage.getItem("cecb_users") || "[]"),
    vendors: JSON.parse(storage.getItem("cecb_vendors") || "[]"),
    products: JSON.parse(storage.getItem("cecb_products") || "[]"),
    orders: JSON.parse(storage.getItem("cecb_orders") || "[]"),
    cart: JSON.parse(storage.getItem("cecb_cart") || "[]"),
    promotions: JSON.parse(storage.getItem("cecb_promotions") || "[]"),
    documents: JSON.parse(storage.getItem("cecb_documents") || "[]"),
  }
}

// Save data to localStorage
export const saveDB = (db: DB) => {
  const storage = getStorage()
  if (!storage) return

  storage.setItem("cecb_users", JSON.stringify(db.users))
  storage.setItem("cecb_vendors", JSON.stringify(db.vendors))
  storage.setItem("cecb_products", JSON.stringify(db.products))
  storage.setItem("cecb_orders", JSON.stringify(db.orders))
  storage.setItem("cecb_cart", JSON.stringify(db.cart))
  storage.setItem("cecb_promotions", JSON.stringify(db.promotions))
  storage.setItem("cecb_documents", JSON.stringify(db.documents))
}

// Generate unique ID
export const generateId = () => {
  return crypto.randomUUID()
}

// Generate document number
export const generateDocumentNumber = (
  type: "FACTURA_VENTA" | "NOTA_CREDITO" | "REMISION",
  documents: Document[],
  vendorId: string,
  vendorIdNumber: string
): string => {
  const prefix = type === "FACTURA_VENTA" ? "FV" : type === "NOTA_CREDITO" ? "NC" : "RM"
  const count = documents.filter((d) => d.vendorId === vendorId && d.type === type).length + 1
  const year = new Date().getFullYear()
  const vendorNum = vendorIdNumber || "000"
  return `${prefix}-${year}-${vendorNum}-${String(count).padStart(4, "0")}`
}

// Create invoice document
export const createInvoiceDocument = (
  order: Order,
  vendors: Vendor[],
  documents: Document[]
): Document => {
  const vendor = vendors.find((v) => v.userId === order.vendorId)
  const docNumber = generateDocumentNumber(
    "FACTURA_VENTA",
    documents,
    order.vendorId,
    vendor?.idNumber || "000"
  )
  const iva = Math.round(order.total * 0.19)
  const base = order.total - iva

  return {
    id: generateId(),
    type: "FACTURA_VENTA",
    number: docNumber,
    orderId: order.id,
    vendorId: order.vendorId,
    vendor: {
      name: vendor?.businessName || "Mi Negocio",
      idType: vendor?.idType || "NIT",
      idNumber: vendor?.idNumber || "000",
      address: vendor?.address || "",
      city: `${vendor?.municipality || ""}, ${vendor?.department || ""}`,
    },
    buyer: {
      name: order.buyerName,
      email: order.buyerEmail || "",
      id: order.buyerId,
    },
    items: order.items.map((i) => ({ ...i })),
    subtotal: base,
    iva: iva,
    total: order.total,
    date: order.date,
    status: "EMITIDA",
    cufe: generateId().slice(0, 20).toUpperCase(),
    paymentMethod: "Nequi QR",
  }
}
