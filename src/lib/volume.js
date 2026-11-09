// volume in both units: { tons: "1.23 tons", kg: "1,234.5 kg" }
export const volume = (kg) => {
  const weight = Number(kg || 0)
  return {
    tons: `${(weight / 1000).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} tons`,
    kg: `${weight.toLocaleString('en-PH', { maximumFractionDigits: 2 })} kg`,
  }
}
