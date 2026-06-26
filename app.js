// POS Professional - Ultra Pro Edition
const db = new PouchDB('pos_pro_db');
let currentUser = null;

// ==================== ROLES & PERMISSIONS ====================
const ROLES = {
  admin: { label: 'Administrateur', permissions: ['*'] },
  manager: { label: 'Gestionnaire', permissions: ['products', 'sales', 'stock', 'staff', 'reports', 'clients'] },
  cashier: { label: 'Caissier', permissions: ['sales', 'reports'] },
  stock: { label: 'Gestion Stock', permissions: ['products', 'stock', 'warehouse'] }
};

function hasPermission(permission) {
  if (!currentUser) return false;
  const role = ROLES[currentUser.role];
  return role?.permissions.includes('*') || role?.permissions.includes(permission);
}

function checkPermission(permission) {
  if (!hasPermission(permission)) {
    alert('❌ Accès refusé. Permissions insuffisantes.');
    return false;
  }
  return true;
}

// ==================== UTILITIES ====================
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), {name: 'PBKDF2'}, false, ['deriveBits','deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256'}, keyMaterial, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// ==================== INITIALIZATION ====================
async function initializeDefaultUsers() {
  const defaultUsers = [
    { username: 'admin', password: 'admin', role: 'admin' },
    { username: 'manager', password: 'manager', role: 'manager' },
    { username: 'cashier', password: 'cashier', role: 'cashier' },
    { username: 'stock', password: 'stock', role: 'stock' }
  ];

  for (const user of defaultUsers) {
    try {
      await db.get('user:' + user.username);
    } catch (err) {
      if (err.status === 404) {
        const salt = crypto.getRandomValues(new Uint8Array(16)).join(',');
        const hashed = await hashPassword(user.password, salt);
        const doc = {
          _id: 'user:' + user.username,
          type: 'user',
          username: user.username,
          salt,
          hashed,
          role: user.role,
          createdAt: new Date().toISOString(),
          createdBy: 'system',
          active: true
        };
        await db.put(doc);
      }
    }
  }
}
async function createUser(username, password, role = 'cashier') {
  if (!currentUser || currentUser.role !== 'admin') {
    alert('❌ Seul un administrateur peut créer des utilisateurs');
    return null;
  }

  const id = 'user:' + username;
  try {
    await db.get(id);
    alert('⚠️ Utilisateur déjà existant');
    return null;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16)).join(',');
  const hashed = await hashPassword(password, salt);
  const doc = {
    _id: id, 
    type: 'user', 
    username, 
    salt, 
    hashed, 
    role,
    createdAt: new Date().toISOString(),
    createdBy: currentUser.username,
    active: true
  };
  await db.put(doc);
  await logAudit('USER_CREATED', `Utilisateur ${username} créé avec rôle ${role}`);
  return doc;
}

async function loginUser(username, password) {
  try {
    const doc = await db.get('user:' + username);
    
    if (!doc.active) {
      alert('⚠️ Cet utilisateur a été désactivé');
      return false;
    }

    const hashed = await hashPassword(password, doc.salt);
    if (hashed === doc.hashed) {
      currentUser = { username, role: doc.role };
      renderUserArea();
      updateNavigation();
      showTab('dashboard');
      await loadAll();
      await logAudit('LOGIN', `${username} connecté`);
      return true;
    }
    alert('❌ Identifiants incorrects');
    return false;
  } catch (err) {
    alert('❌ Utilisateur non trouvé');
    return false;
  }
}

function logout() {
  if (currentUser) {
    logAudit('LOGOUT', `${currentUser.username} déconnecté`);
  }
  currentUser = null;
  renderUserArea();
  updateNavigation();
  showTab('auth');
}

// ==================== UI RENDERING ====================
function renderUserArea() {
  const area = document.getElementById('user-area');
  if (currentUser) {
    const roleLabel = ROLES[currentUser.role]?.label || currentUser.role;
    area.innerHTML = `
      <div id="user-info">
        <span>${currentUser.username}</span>
        <span class="role-badge">${roleLabel}</span>
        <a href="#" id="logout-link">Déconnexion</a>
      </div>
    `;
    const l = document.getElementById('logout-link');
    if (l) l.addEventListener('click', (e) => { e.preventDefault(); logout(); });
  } else {
    area.innerHTML = '<em>Non connecté</em>';
  }
}

function updateNavigation() {
  const nav = document.querySelector('nav');
  document.querySelectorAll('nav button').forEach(btn => {
    const permission = btn.dataset.permission;
    if (permission && !hasPermission(permission)) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'block';
    }
  });
}

async function showTab(name) {
  document.querySelectorAll('section.tab').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  
  const section = document.getElementById(name);
  if (section) {
    section.classList.remove('hidden');
    const btn = document.querySelector(`nav button[data-tab="${name}"]`);
    if (btn) btn.classList.add('active');
    
    // Load data for the tab
    if (name !== 'auth') {
      await loadAll();
    }
  }
}

// ==================== AUDIT LOG ====================
async function logAudit(action, details) {
  const doc = {
    _id: 'audit:' + Date.now(),
    type: 'audit',
    action,
    details,
    user: currentUser?.username || 'system',
    timestamp: new Date().toISOString()
  };
  await db.put(doc);
}

// ==================== PRODUCTS ====================
async function addOrUpdateProduct(data) {
  if (!checkPermission('products')) return null;

  const id = data.sku ? 'product:' + data.sku : 'product:' + Date.now();
  try {
    const existing = await db.get(id);
    existing.name = data.name;
    existing.category = data.category;
    existing.price = Number(data.price);
    existing.cost = Number(data.cost);
    existing.stock = Number(data.stock);
    existing.barcode = data.barcode;
    existing.updatedAt = new Date().toISOString();
    await db.put(existing);
    await logAudit('PRODUCT_UPDATED', `Produit ${data.name} mis à jour`);
  } catch (err) {
    if (err.status === 404) {
      const doc = {
        _id: id, 
        type: 'product', 
        name: data.name, 
        category: data.category,
        sku: data.sku || id, 
        price: Number(data.price),
        cost: Number(data.cost),
        stock: Number(data.stock),
        barcode: data.barcode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.put(doc);
      await logAudit('PRODUCT_CREATED', `Produit ${data.name} créé`);
      return doc;
    }
    throw err;
  }
}

async function listProducts(category = null) {
  const all = await db.allDocs({ include_docs: true });
  let products = all.rows.map(r => r.doc).filter(d => d.type === 'product');
  if (category) products = products.filter(p => p.category === category);
  return products;
}

async function renderProducts() {
  if (!hasPermission('products')) return;
  
  const products = await listProducts();
  const tbody = document.querySelector('#products-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const select = document.getElementById('sale-product');
  if (select) select.innerHTML = '';

  for (const p of products) {
    const profit = p.stock > 0 ? ((p.price - (p.cost || 0)) * p.stock).toFixed(0) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.category || '-'}</td>
      <td>${p.sku || '-'}</td>
      <td>${p.price}</td>
      <td style="color: ${p.stock < 5 ? 'red' : 'green'}; font-weight: bold;">${p.stock}</td>
      <td>${profit}</td>
      <td>
        <button class="secondary" onclick="editProduct('${p._id}')">✏️</button>
        <button class="danger" onclick="deleteProduct('${p._id}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
    
    if (select) {
      const opt = document.createElement('option');
      opt.value = p._id;
      opt.textContent = `${p.name} (Stock: ${p.stock}) — ${p.price} Ar`;
      select.appendChild(opt);
    }
  }
}

function editProduct(id) {
  alert('Fonctionnalité édition à implémenter');
}

async function deleteProduct(id) {
  if (!checkPermission('products')) return;
  if (confirm('Supprimer ce produit ?')) {
    const d = await db.get(id);
    await db.remove(d);
    await logAudit('PRODUCT_DELETED', `Produit supprimé`);
    await renderProducts();
  }
}

// ==================== CLIENTS ====================
async function addClient(data) {
  if (!checkPermission('clients')) return null;
  const doc = {
    _id: 'client:' + Date.now(),
    type: 'client',
    name: data.name,
    phone: data.phone,
    email: data.email,
    address: data.address,
    totalPurchases: 0,
    createdAt: new Date().toISOString()
  };
  await db.put(doc);
  await logAudit('CLIENT_CREATED', `Client ${data.name} créé`);
  return doc;
}

async function listClients() {
  const all = await db.allDocs({ include_docs: true });
  return all.rows.map(r => r.doc).filter(d => d.type === 'client');
}

async function renderClients() {
  if (!hasPermission('clients')) return;
  const clients = await listClients();
  const tbody = document.querySelector('#clients-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  for (const c of clients) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.email || '-'}</td>
      <td>${c.totalPurchases.toFixed(0)} Ar</td>
      <td>
        <button class="secondary">✏️</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function editClient(id) {
  alert('Édition client à implémenter');
}

// ==================== SALES ====================
async function addSale(productId, qty, clientId = null, discount = 0) {
  if (!checkPermission('sales')) return null;
  
  const p = await db.get(productId);
  if (!p) throw new Error('Produit introuvable');
  if (p.stock < qty) {
    alert('❌ Stock insuffisant');
    return null;
  }

  p.stock = p.stock - qty;
  await db.put(p);

  const amount = (Number(p.price) * qty) - discount;
  const sale = {
    _id: 'sale:' + Date.now(),
    type: 'sale',
    productId,
    productName: p.name,
    qty,
    unitPrice: p.price,
    discount,
    amount,
    clientId,
    date: new Date().toISOString(),
    user: currentUser?.username || 'unknown'
  };
  await db.put(sale);

  if (clientId) {
    const client = await db.get(clientId);
    client.totalPurchases = (client.totalPurchases || 0) + amount;
    await db.put(client);
  }

  await logAudit('SALE', `Vente: ${p.name} x${qty} = ${amount} Ar`);
  return sale;
}

async function addReturn(saleId, returnQty, reason) {
  if (!checkPermission('sales')) return null;
  
  const sale = await db.get(saleId);
  const product = await db.get(sale.productId);
  
  product.stock = product.stock + returnQty;
  await db.put(product);

  const returnAmount = (sale.unitPrice * returnQty);
  const returnDoc = {
    _id: 'return:' + Date.now(),
    type: 'return',
    saleId,
    productName: sale.productName,
    qty: returnQty,
    amount: returnAmount,
    reason,
    date: new Date().toISOString(),
    user: currentUser?.username
  };
  await db.put(returnDoc);
  await logAudit('RETURN', `Retour: ${sale.productName} x${returnQty} (${reason})`);
  return returnDoc;
}

async function listSales(days = 30) {
  const all = await db.allDocs({ include_docs: true });
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return all.rows.map(r => r.doc)
    .filter(d => d.type === 'sale' && d.date >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function renderSales() {
  if (!hasPermission('sales')) return;
  const sales = await listSales();
  const tbody = document.querySelector('#sales-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const s of sales) {
    const tr = document.createElement('tr');
    const discountStr = s.discount > 0 ? ` -${s.discount}` : '';
    tr.innerHTML = `
      <td>${new Date(s.date).toLocaleString()}</td>
      <td>${s.productName}</td>
      <td>${s.qty}</td>
      <td>${s.unitPrice}</td>
      <td style="color: ${s.discount > 0 ? 'green' : 'black'}">${discountStr}</td>
      <td><strong>${s.amount}</strong></td>
      <td>
        <button class="secondary" onclick="showReturnForm('${s._id}')">↩️ Retour</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// ==================== REPORTS ====================
async function generateDailyReport() {
  const today = new Date().toDateString();
  const sales = await listSales(1);
  const todaySales = sales.filter(s => new Date(s.date).toDateString() === today);
  
  const totalAmount = todaySales.reduce((s, i) => s + i.amount, 0);
  const totalQty = todaySales.reduce((s, i) => s + i.qty, 0);
  
  const products = await listProducts();
  const totalCost = todaySales.reduce((sum, sale) => {
    const product = products.find(p => p._id === sale.productId);
    return sum + (product?.cost || 0) * sale.qty;
  }, 0);
  
  const profit = totalAmount - totalCost;
  
  return {
    date: today,
    transactions: todaySales.length,
    totalQty,
    totalAmount,
    totalCost,
    profit,
    profitMargin: totalAmount > 0 ? ((profit / totalAmount) * 100).toFixed(1) : 0
  };
}

async function renderDashboard() {
  const report = await generateDailyReport();
  const products = await listProducts();
  const clients = await listClients();
  const users = await listUsers();
  
  const lowStockCount = products.filter(p => p.stock < 5).length;
  
  const stats = document.getElementById('dashboard-stats');
  if (!stats) return;
  
  stats.innerHTML = `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="label">Produits</div>
        <div class="value">${products.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Stock Critique</div>
        <div class="value" style="color: red;">${lowStockCount}</div>
      </div>
      <div class="stat-card">
        <div class="label">Clients</div>
        <div class="value">${clients.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Ventes Aujourd'hui</div>
        <div class="value">${report.transactions}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total (Ar)</div>
        <div class="value">${report.totalAmount.toFixed(0)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Profit</div>
        <div class="value" style="color: green;">${report.profit.toFixed(0)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Marge %</div>
        <div class="value">${report.profitMargin}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Utilisateurs</div>
        <div class="value">${users.length}</div>
      </div>
    </div>
  `;
}

// ==================== USERS MANAGEMENT ====================
async function listUsers() {
  const all = await db.allDocs({ include_docs: true });
  return all.rows.map(r => r.doc).filter(d => d.type === 'user');
}

async function renderUserManagement() {
  if (currentUser.role !== 'admin') {
    const container = document.getElementById('users-section');
    if (container) container.innerHTML = '<div class="permission-denied">❌ Seul un administrateur peut gérer les utilisateurs</div>';
    return;
  }

  const users = await listUsers();
  const tbody = document.querySelector('#users-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const u of users) {
    const roleLabel = ROLES[u.role]?.label || u.role;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${roleLabel}</td>
      <td><span style="background: ${u.active ? '#34a853' : '#ea4335'}; color: white; padding: 4px 8px; border-radius: 4px;">${u.active ? 'Actif' : 'Inactif'}</span></td>
      <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="secondary" onclick="toggleUserStatus('${u._id}', ${!u.active})">
          ${u.active ? '❌ Désactiver' : '✅ Activer'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function toggleUserStatus(userId, activate) {
  if (currentUser.role !== 'admin') {
    alert('❌ Seul un administrateur peut modifier les utilisateurs');
    return;
  }

  const user = await db.get(userId);
  user.active = activate;
  await db.put(user);
  await logAudit('USER_' + (activate ? 'ACTIVATED' : 'DEACTIVATED'), `Utilisateur ${user.username}`);
  await renderUserManagement();
}

// ==================== STOCK ====================
async function renderStock() {
  if (!hasPermission('stock')) return;
  
  const products = await listProducts();
  const tbody = document.querySelector('#stock-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const p of products) {
    const tr = document.createElement('tr');
    const status = p.stock > 20 ? '✅ Normal' : p.stock > 5 ? '⚠️ Alerte' : '❌ Critique';
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.sku}</td>
      <td>${p.stock}</td>
      <td>${status}</td>
      <td><button class="secondary" onclick="updateStock('${p._id}')">Ajuster</button></td>
    `;
    tbody.appendChild(tr);
  }
}

async function updateStock(productId) {
  const product = await db.get(productId);
  const newStock = prompt(`Nouveau stock pour ${product.name} (actuel: ${product.stock}):`, product.stock);
  
  if (newStock !== null) {
    const difference = Number(newStock) - product.stock;
    product.stock = Number(newStock);
    await db.put(product);
    await logAudit('STOCK_ADJUSTED', `${product.name}: ${difference > 0 ? '+' : ''}${difference}`);
    await renderStock();
  }
}

function showReturnForm(saleId) {
  const qty = prompt('Quantité à retourner:');
  const reason = prompt('Raison du retour:');
  if (qty && reason) {
    addReturn(saleId, Number(qty), reason).then(() => {
      alert('✅ Retour enregistré');
      renderSales();
      renderProducts();
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize default users on first launch
  await initializeDefaultUsers();
  
  // Auth
  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
      const u = document.getElementById('login-username').value.trim();
      const p = document.getElementById('login-password').value;
      if (!u || !p) return alert('⚠️ Remplir identifiant et mot de passe');
      await loginUser(u, p);
    });
  }

  // Admin: Create User
  const btnAdminCreateUser = document.getElementById('btn-admin-create-user');
  if (btnAdminCreateUser) {
    btnAdminCreateUser.addEventListener('click', async () => {
      if (currentUser.role !== 'admin') return alert('❌ Accès refusé');
      
      const username = prompt('Nom d\'utilisateur:');
      if (!username) return;
      
      const password = prompt('Mot de passe:');
      if (!password) return;
      
      const role = prompt('Rôle (admin/manager/cashier/stock):', 'cashier');
      if (!role) return;
      
      await createUser(username, password, role);
      alert('✅ Utilisateur créé');
      await renderUserManagement();
    });
  }

  // Tabs
  document.querySelectorAll('nav button').forEach(b => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });

  // ==================== SALES EVENTS ====================
  
  // Search products
  const searchProduct = document.getElementById('search-product');
  if (searchProduct) {
    searchProduct.addEventListener('input', (e) => searchProducts(e.target.value));
  }

  // Cart discount
  const cartDiscount = document.getElementById('cart-discount');
  if (cartDiscount) {
    cartDiscount.addEventListener('change', () => renderCart());
  }

  // Cash received
  const cashReceived = document.getElementById('cash-received');
  if (cashReceived) {
    cashReceived.addEventListener('input', updateCashChange);
  }

  // Payment mode change
  document.querySelectorAll('input[name="payment-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const cashSection = document.getElementById('cash-payment');
      const creditSection = document.getElementById('credit-payment');
      
      if (e.target.value === 'cash') {
        if (cashSection) cashSection.style.display = 'grid';
        if (creditSection) creditSection.style.display = 'none';
      } else if (e.target.value === 'credit') {
        if (cashSection) cashSection.style.display = 'none';
        if (creditSection) creditSection.style.display = 'grid';
      } else {
        if (cashSection) cashSection.style.display = 'grid';
        if (creditSection) creditSection.style.display = 'grid';
      }
    });
  });

  // Complete sale
  const btnCompleteSale = document.getElementById('btn-complete-sale');
  if (btnCompleteSale) {
    btnCompleteSale.addEventListener('click', completeSale);
  }

  // Clear cart
  const btnClearCart = document.getElementById('btn-clear-cart');
  if (btnClearCart) {
    btnClearCart.addEventListener('click', () => {
      cartItems = [];
      renderCart();
    });
  }

  // ==================== RETURNS EVENTS ====================
  
  const returnForm = document.getElementById('return-form');
  if (returnForm) {
    returnForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const productName = document.getElementById('return-product').value;
      const quantity = Number(document.getElementById('return-qty').value);
      const reason = document.getElementById('return-reason').value;
      const notes = document.getElementById('return-notes').value;
      
      if (!productName || !quantity || !reason) {
        return alert('⚠️ Remplir les champs requis');
      }

      await addReturn(productName, quantity, reason, notes);
      alert('✅ Retour enregistré');
      returnForm.reset();
      await renderReturns();
    });
  }

  // ==================== CREDITS EVENTS ====================
  
  const creditForm = document.getElementById('credit-form');
  if (creditForm) {
    creditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = document.getElementById('credit-client-select').value;
      const amount = Number(document.getElementById('credit-amount').value);
      const motif = document.getElementById('credit-motif').value;
      
      if (!clientId || !amount) {
        return alert('⚠️ Remplir les champs requis');
      }

      await addCredit(clientId, amount, motif);
      alert('✅ Crédit ajouté');
      creditForm.reset();
      await renderCredits();
    });
  }

  const useCreditForm = document.getElementById('use-credit-form');
  if (useCreditForm) {
    useCreditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = document.getElementById('use-credit-client').value;
      const amount = -Number(document.getElementById('credit-use-amount').value);
      
      if (!clientId || amount >= 0) {
        return alert('⚠️ Données invalides');
      }

      await addCredit(clientId, amount, 'Utilisation crédit');
      alert('✅ Crédit utilisé');
      useCreditForm.reset();
      await renderCredits();
    });
  }

  // ==================== ORDERS EVENTS ====================
  
  const orderForm = document.getElementById('order-form');
  if (orderForm) {
    orderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientId = document.getElementById('order-client').value;
      const productId = document.getElementById('order-product').value;
      const quantity = Number(document.getElementById('order-qty').value);
      const deliveryDate = document.getElementById('order-date').value;
      const notes = document.getElementById('order-notes').value;
      
      if (!clientId || !productId || !quantity || !deliveryDate) {
        return alert('⚠️ Remplir les champs requis');
      }

      await createOrder(clientId, productId, quantity, deliveryDate, notes);
      alert('✅ Commande créée');
      orderForm.reset();
      await renderOrders();
    });
  }

  // Order status filter
  document.querySelectorAll('input[name="order-status"]').forEach(radio => {
    radio.addEventListener('change', renderOrders);
  });

  // ==================== PRODUCTS FORM ====================
  const productForm = document.getElementById('product-form');
  if (productForm) {
    productForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        name: document.getElementById('p-name').value.trim(),
        category: document.getElementById('p-category').value.trim(),
        sku: document.getElementById('p-sku').value.trim() || null,
        price: Number(document.getElementById('p-price').value),
        cost: Number(document.getElementById('p-cost').value),
        stock: Number(document.getElementById('p-stock').value),
        barcode: document.getElementById('p-barcode').value.trim()
      };
      await addOrUpdateProduct(data);
      productForm.reset();
      await renderProducts();
      alert('✅ Produit ajouté');
    });
  }

  // ==================== CLIENTS FORM ====================
  const clientForm = document.getElementById('client-form');
  if (clientForm) {
    clientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        name: document.getElementById('c-name').value.trim(),
        phone: document.getElementById('c-phone').value.trim(),
        email: document.getElementById('c-email').value.trim(),
        address: document.getElementById('c-address').value.trim()
      };
      await addClient(data);
      clientForm.reset();
      await renderClients();
      alert('✅ Client créé');
    });
  }

  renderUserArea();
  updateNavigation();
  showTab('auth');
});

// ==================== ADDITIONAL FUNCTIONS ====================
async function showDailyReport() {
  const report = await generateDailyReport();
  alert(`
📅 RAPPORT QUOTIDIEN - ${report.date}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Transactions: ${report.transactions}
📦 Quantités vendues: ${report.totalQty} unités
💰 Montant total: ${report.totalAmount.toFixed(0)} Ar
💵 Coût total: ${report.totalCost.toFixed(0)} Ar
📈 Profit réalisé: ${report.profit.toFixed(0)} Ar
📊 Marge: ${report.profitMargin}%
  `);
}

async function showMonthlyReport() {
  const sales = await listSales(30);
  const totalAmount = sales.reduce((s, i) => s + i.amount, 0);
  const products = await listProducts();
  const totalCost = sales.reduce((sum, sale) => {
    const product = products.find(p => p._id === sale.productId);
    return sum + (product?.cost || 0) * sale.qty;
  }, 0);
  
  alert(`
📅 RAPPORT MENSUEL (30 jours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Transactions: ${sales.length}
💰 Montant total: ${totalAmount.toFixed(0)} Ar
💵 Coût total: ${totalCost.toFixed(0)} Ar
📈 Profit: ${(totalAmount - totalCost).toFixed(0)} Ar
📊 Marge moyenne: ${totalAmount > 0 ? (((totalAmount - totalCost) / totalAmount) * 100).toFixed(1) : 0}%
  `);
}

async function exportDB() {
  const all = await db.allDocs({ include_docs: true });
  const json = JSON.stringify(all.rows.map(r => r.doc), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pos_pro_export_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  alert('✅ Base de données exportée');
}

async function importDB(file) {
  const text = await file.text();
  const docs = JSON.parse(text);
  await db.bulkDocs(docs.map(d => { delete d._rev; return d; }));
  alert('✅ Import terminé');
  await loadAll();
}

function syncDatabase() {
  const remoteUrl = document.getElementById('sync-url').value.trim();
  if (!remoteUrl) return alert('⚠️ Veuillez entrer une URL CouchDB');
  
  const remote = new PouchDB(remoteUrl);
  db.sync(remote, { live: true, retry: true })
    .on('complete', () => alert('✅ Synchronisation complétée'))
    .on('error', e => alert('❌ Erreur de synchronisation: ' + e.message));
  alert('🔄 Synchronisation lancée (mode live)');
}

// ==================== CART SYSTEM ====================
let cartItems = [];
let cashMode = 'cash';

function addToCart(productId, quantity = 1) {
  if (!checkPermission('sales')) return;
  
  const existingItem = cartItems.find(item => item.productId === productId);
  
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cartItems.push({ productId, quantity });
  }
  
  renderCart();
}

function removeFromCart(productId) {
  cartItems = cartItems.filter(item => item.productId !== productId);
  renderCart();
}

function updateCartQty(productId, quantity) {
  const item = cartItems.find(item => item.productId === productId);
  if (item) {
    item.quantity = Math.max(0, quantity);
    if (item.quantity === 0) removeFromCart(productId);
    renderCart();
  }
}

async function renderCart() {
  const cartContainer = document.getElementById('cart-items');
  if (!cartContainer) return;
  
  if (cartItems.length === 0) {
    cartContainer.innerHTML = '<p style="text-align: center; color: #999;">Panier vide</p>';
    document.getElementById('cart-subtotal').value = '0';
    document.getElementById('cart-total').textContent = '0 Ar';
    return;
  }

  let subtotal = 0;
  let html = '';

  for (const item of cartItems) {
    const product = await db.get(item.productId);
    const total = product.price * item.quantity;
    subtotal += total;

    html += `
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 8px; border-bottom: 1px solid #eee; align-items: center;">
        <div>
          <div style="font-weight: bold;">${product.name}</div>
          <div style="font-size: 12px; color: #666;">${product.price} Ar × 
            <input type="number" value="${item.quantity}" min="1" max="${product.stock}" style="width: 40px;" 
              onchange="updateCartQty('${item.productId}', this.value)" />
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: bold;">${total} Ar</div>
          <button class="danger" onclick="removeFromCart('${item.productId}')" style="padding: 4px 8px; font-size: 11px;">❌</button>
        </div>
      </div>
    `;
  }

  cartContainer.innerHTML = html;
  
  const discount = Number(document.getElementById('cart-discount').value) || 0;
  const total = subtotal - discount;

  document.getElementById('cart-subtotal').value = subtotal.toFixed(0);
  document.getElementById('cart-total').textContent = total.toFixed(0) + ' Ar';
  
  updateCashChange();
}

function updateCashChange() {
  const totalText = document.getElementById('cart-total').textContent || '0 Ar';
  const total = Number(totalText.replace(' Ar', '')) || 0;
  const received = Number(document.getElementById('cash-received').value) || 0;
  const change = Math.max(0, received - total);
  
  const changeElement = document.getElementById('cash-change');
  if (changeElement) {
    changeElement.textContent = change.toFixed(0) + ' Ar';
    changeElement.style.color = change >= 0 ? '#34a853' : '#ea4335';
  }
}

// ==================== SALES SYSTEM ====================
async function searchProducts(query) {
  if (!query.trim()) {
    document.getElementById('products-search-results').innerHTML = '';
    return;
  }

  const products = await listProducts();
  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.sku && p.sku.includes(query))
  );

  let html = '';
  for (const p of filtered) {
    const stockColor = p.stock > 0 ? '#34a853' : '#ea4335';
    html += `
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; align-items: center;">
        <div>
          <div style="font-weight: bold;">${p.name}</div>
          <div style="font-size: 12px; color: #666;">
            ${p.category ? p.category + ' • ' : ''}
            ${p.sku ? 'SKU: ' + p.sku : ''}
          </div>
          <div style="font-size: 14px; font-weight: bold; color: #1a73e8;">${p.price} Ar</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 12px; color: ${stockColor}; font-weight: bold;">Stock: ${p.stock}</div>
          ${p.stock > 0 ? `
            <div style="display: grid; gap: 4px; margin-top: 8px;">
              <button class="primary" onclick="addToCart('${p._id}', 1)" style="padding: 8px 12px; font-size: 12px;">Vendre</button>
            </div>
          ` : '<div style="color: #ea4335; font-size: 12px;">❌ Rupture</div>'}
        </div>
      </div>
    `;
  }

  document.getElementById('products-search-results').innerHTML = html || '<p style="color: #999; text-align: center;">Aucun produit trouvé</p>';
}

async function completeSale() {
  if (cartItems.length === 0) {
    alert('⚠️ Panier vide');
    return;
  }

  const paymentMode = document.querySelector('input[name="payment-mode"]:checked').value;
  const discount = Number(document.getElementById('cart-discount').value) || 0;

  if (paymentMode === 'cash') {
    const received = Number(document.getElementById('cash-received').value) || 0;
    const totalText = document.getElementById('cart-total').textContent || '0 Ar';
    const total = Number(totalText.replace(' Ar', '')) || 0;
    
    if (received < total) {
      alert('❌ Montant insuffisant');
      return;
    }
  } else if (paymentMode === 'credit') {
    const clientId = document.getElementById('credit-client').value;
    if (!clientId) {
      alert('⚠️ Sélectionner un client');
      return;
    }
  }

  // Enregistrer la vente
  for (const item of cartItems) {
    const product = await db.get(item.productId);
    
    if (product.stock < item.quantity) {
      alert(`❌ Stock insuffisant pour ${product.name}`);
      return;
    }

    product.stock -= item.quantity;
    await db.put(product);

    const saleDoc = {
      _id: 'sale:' + Date.now() + Math.random(),
      type: 'sale',
      productId: item.productId,
      productName: product.name,
      qty: item.quantity,
      unitPrice: product.price,
      discount,
      amount: (product.price * item.quantity) - discount,
      paymentMode,
      date: new Date().toISOString(),
      user: currentUser?.username,
      clientId: paymentMode === 'credit' ? document.getElementById('credit-client').value : null
    };

    await db.put(saleDoc);
    await logAudit('SALE', `Vente: ${product.name} x${item.quantity}`);
  }

  alert('✅ Vente enregistrée');
  cartItems = [];
  document.getElementById('cart-discount').value = 0;
  document.getElementById('cash-received').value = 0;
  renderCart();
  await renderSales();
  await renderProducts();
}

// ==================== RETURNS SYSTEM ====================
async function addReturn(productName, quantity, reason, notes) {
  if (!checkPermission('sales')) return null;

  const products = await listProducts();
  const product = products.find(p => p.name === productName);
  
  if (!product) return null;

  // Restaurer le stock
  product.stock += quantity;
  await db.put(product);

  const returnDoc = {
    _id: 'return:' + Date.now(),
    type: 'return',
    productName,
    quantity,
    amount: product.price * quantity,
    reason,
    notes,
    date: new Date().toISOString(),
    user: currentUser?.username
  };

  await db.put(returnDoc);
  await logAudit('RETURN', `Retour: ${productName} x${quantity} (${reason})`);
  return returnDoc;
}

async function renderReturns() {
  const all = await db.allDocs({ include_docs: true });
  const returns = all.rows.map(r => r.doc).filter(d => d.type === 'return');
  
  const tbody = document.querySelector('#returns-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const ret of returns.slice(-20)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(ret.date).toLocaleDateString()}</td>
      <td>-</td>
      <td>${ret.productName}</td>
      <td>${ret.quantity}</td>
      <td>${ret.amount}</td>
      <td>${ret.reason}</td>
      <td><span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px;">Complété</span></td>
    `;
    tbody.appendChild(tr);
  }
}

// ==================== CREDIT SYSTEM ====================
async function addCredit(clientId, amount, motif) {
  if (!checkPermission('sales')) return null;

  const creditDoc = {
    _id: 'credit:' + Date.now(),
    type: 'credit',
    clientId,
    amount,
    motif,
    date: new Date().toISOString(),
    user: currentUser?.username
  };

  await db.put(creditDoc);
  await logAudit('CREDIT_ADDED', `Crédit +${amount} Ar`);
  return creditDoc;
}

async function getClientCredit(clientId) {
  const all = await db.allDocs({ include_docs: true });
  const credits = all.rows.map(r => r.doc).filter(d => d.type === 'credit' && d.clientId === clientId);
  
  let balance = 0;
  for (const c of credits) {
    if (c.amount > 0) balance += c.amount; // Ajouter crédit
    else balance += c.amount; // Retirer crédit
  }

  return balance;
}

async function renderCredits() {
  const all = await db.allDocs({ include_docs: true });
  const credits = all.rows.map(r => r.doc).filter(d => d.type === 'credit');
  
  const tbody = document.querySelector('#credits-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const c of credits.slice(-20)) {
    const client = await db.get(c.clientId).catch(() => ({ username: 'Unknown' }));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(c.date).toLocaleDateString()}</td>
      <td>${client.name || 'N/A'}</td>
      <td>${c.amount > 0 ? 'Crédit' : 'Utilisation'}</td>
      <td>${Math.abs(c.amount)}</td>
      <td>-</td>
      <td>${c.motif || '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ==================== ORDERS SYSTEM ====================
async function createOrder(clientId, productId, quantity, deliveryDate, notes) {
  if (!checkPermission('sales')) return null;

  const product = await db.get(productId);
  const total = product.price * quantity;

  const orderDoc = {
    _id: 'order:' + Date.now(),
    type: 'order',
    clientId,
    productId,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    total,
    deliveryDate,
    notes,
    status: 'pending',
    createdAt: new Date().toISOString(),
    user: currentUser?.username
  };

  await db.put(orderDoc);
  await logAudit('ORDER_CREATED', `Commande: ${product.name} x${quantity}`);
  return orderDoc;
}

async function updateOrderStatus(orderId, newStatus) {
  const order = await db.get(orderId);
  order.status = newStatus;
  await db.put(order);
  await logAudit('ORDER_STATUS', `Statut changé: ${newStatus}`);
}

async function renderOrders() {
  const all = await db.allDocs({ include_docs: true });
  let orders = all.rows.map(r => r.doc).filter(d => d.type === 'order');
  
  const statusFilter = document.querySelector('input[name="order-status"]:checked')?.value;
  if (statusFilter && statusFilter !== 'all') {
    orders = orders.filter(o => o.status === statusFilter);
  }

  const tbody = document.querySelector('#orders-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const o of orders) {
    const client = await db.get(o.clientId).catch(() => ({ name: 'Unknown' }));
    const statusBadge = {
      pending: '⏳ En attente',
      confirmed: '✅ Confirmée',
      delivered: '📦 Livrée',
      cancelled: '❌ Annulée'
    }[o.status];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o._id.slice(6, 14)}</td>
      <td>${client.name}</td>
      <td>${o.productName}</td>
      <td>${o.quantity}</td>
      <td>${o.total}</td>
      <td>${new Date(o.deliveryDate).toLocaleDateString()}</td>
      <td>${statusBadge}</td>
      <td>
        <select onchange="updateOrderStatus('${o._id}', this.value)" style="padding: 4px;">
          <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Attente</option>
          <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>Confirmée</option>
          <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Livrée</option>
          <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Annulée</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  }
}
async function loadAll() {
  if (!currentUser) return;
  
  await renderDashboard();
  await renderProducts();
  await renderSales();
  await renderStock();
  await renderClients();
  await renderReturns();
  await renderCredits();
  await renderOrders();
  await populateSelects();
  
  if (currentUser.role === 'admin') {
    await renderUserManagement();
  }
}

async function populateSelects() {
  const clients = await listClients();
  const products = await listProducts();

  // Credit client select
  const creditClientSelect = document.getElementById('credit-client-select');
  if (creditClientSelect) {
    creditClientSelect.innerHTML = '<option value="">— Sélectionner client —</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = c.name;
      creditClientSelect.appendChild(opt);
    });
  }

  // Use credit client select
  const useCreditClient = document.getElementById('use-credit-client');
  if (useCreditClient) {
    useCreditClient.innerHTML = '<option value="">— Sélectionner client —</option>';
    for (const c of clients) {
      const balance = await getClientCredit(c._id);
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = `${c.name} (Crédit: ${balance} Ar)`;
      useCreditClient.appendChild(opt);
    }
  }

  // Order client select
  const orderClient = document.getElementById('order-client');
  if (orderClient) {
    orderClient.innerHTML = '<option value="">— Sélectionner client —</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = c.name;
      orderClient.appendChild(opt);
    });
  }

  // Order product select
  const orderProduct = document.getElementById('order-product');
  if (orderProduct) {
    orderProduct.innerHTML = '<option value="">— Sélectionner produit —</option>';
    products.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p._id;
      opt.textContent = `${p.name} (${p.price} Ar)`;
      orderProduct.appendChild(opt);
    });
  }

  // Credit client (sale)
  const creditClient = document.getElementById('credit-client');
  if (creditClient) {
    creditClient.innerHTML = '<option value="">— Aucun —</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = c.name;
      creditClient.appendChild(opt);
    });
  }
}
