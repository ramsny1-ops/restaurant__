import { run, transaction } from '../database/index.js';
import { id, secret } from './common.js';
export function createBranch(businessId: string, name: string, phone = '', withMenu = false) {
  const branchId = id();
  run(
    'INSERT INTO branches(id,business_id,name,phone) VALUES(?,?,?,?)',
    branchId,
    businessId,
    name,
    phone,
  );
  for (let n = 1; n <= 8; n++) {
    const tableId = id();
    run(
      'INSERT INTO dining_tables(id,branch_id,label) VALUES(?,?,?)',
      tableId,
      branchId,
      `Table ${String(n).padStart(2, '0')}`,
    );
    run('INSERT INTO qr_tokens VALUES(?,?,?,?,1)', id(), secret(), branchId, tableId);
  }
  if (withMenu) {
    const dishes = [
      [
        'From the grill',
        'Charcoal chicken',
        'Flame-grilled chicken with charred vegetables, fresh herbs and lemon.',
        18000,
        25,
        '',
      ],
      [
        'From the grill',
        'Beef mishkaki',
        'Tender skewers with warm flatbread and a house chilli sauce.',
        14000,
        20,
        '',
      ],
      [
        'Coastal kitchen',
        'Coconut fish curry',
        'Catch of the day in coconut milk, turmeric and lime. Served with rice.',
        22000,
        25,
        'Contains fish',
      ],
      [
        'Coastal kitchen',
        'Vegetable pilau',
        'Fragrant spiced rice, seasonal vegetables and a cucumber salad.',
        12000,
        15,
        'Vegetarian',
      ],
      [
        'Small plates',
        'Crispy cassava',
        'Golden cassava fries with lemon, sea salt and tamarind dip.',
        6000,
        10,
        'Vegetarian',
      ],
      [
        'Small plates',
        'Samosa trio',
        'Three crisp vegetable samosas, fresh herbs and a cooling dip.',
        5000,
        10,
        'Vegetarian',
      ],
      [
        'Something sweet',
        'Coconut panna cotta',
        'Soft coconut cream, tropical fruit and toasted coconut.',
        8000,
        5,
        'Contains dairy',
      ],
      [
        'Drinks',
        'Passion fruit cooler',
        'Fresh passion fruit, a little lime and crushed ice.',
        5000,
        5,
        '',
      ],
      [
        'Drinks',
        'Ginger lemonade',
        'Freshly squeezed lemon and a sharp kick of ginger.',
        5000,
        5,
        '',
      ],
      [
        'Drinks',
        'Spiced coffee',
        'Locally roasted coffee with a fragrant cardamom finish.',
        4500,
        5,
        '',
      ],
    ] as const;
    const categories = new Map<string, string>();
    for (const [category, name, description, price, prep, dietary] of dishes) {
      if (!categories.has(category)) {
        const categoryId = id();
        categories.set(category, categoryId);
        run(
          'INSERT INTO categories VALUES(?,?,?,?)',
          categoryId,
          branchId,
          category,
          categories.size,
        );
      }
      run(
        'INSERT INTO menu_items(id,branch_id,category_id,name,description,price,prep_minutes,dietary,modifiers) VALUES(?,?,?,?,?,?,?,?,?)',
        id(),
        branchId,
        categories.get(category)!,
        name,
        description,
        price,
        prep,
        dietary,
        JSON.stringify(
          category === 'From the grill'
            ? [
                { id: 'avocado', name: 'Avocado', price: 3000 },
                { id: 'extra-sauce', name: 'Extra sauce', price: 1000 },
              ]
            : [],
        ),
      );
    }
    run(
      'UPDATE menu_items SET image_url=? WHERE branch_id=? AND name=?',
      '/assets/images/grilled-chicken.jpg',
      branchId,
      'Charcoal chicken',
    );
  }
  return branchId;
}
export function createBusiness(name: string, branchName: string, withMenu = false) {
  return transaction(() => {
    const businessId = id();
    run('INSERT INTO businesses(id,name) VALUES(?,?)', businessId, name);
    const branchId = createBranch(businessId, branchName, withMenu);
    return { businessId, branchId };
  });
}
