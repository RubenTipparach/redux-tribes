using System.Collections;
using System.Collections.Generic;
using CampaignV2;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class WeaponUnitManager : MonoBehaviour
{
    public TextMeshProUGUI weaponName;

    public TextMeshProUGUI healthText;
    public Slider healthSlider;

    public TextMeshProUGUI repairText;
    public Button repairButton;

    ShipSave ship;
    public WeaponSaveData weapon;


    public ShipManagerUnit shipUIUnit;

    public float discount = .5f;

    public void SetWeapon(WeaponSaveData weaponSaveData,
        ShipSave shipSave,
        ShipManagerUnit shipThumbnail)
    {
        weapon = weaponSaveData;
        ship = shipSave;
        shipUIUnit = shipThumbnail;

        weaponName.text = weapon.weaponName;

        healthSlider.value = weapon.healthRemaining.ToPercent;

        //repairText.text = $"";
        healthText.text = $"{Mathf.CeilToInt(weaponSaveData.healthRemaining.value)}/{Mathf.CeilToInt(weaponSaveData.healthRemaining.initial)}";
        if (weapon.healthRemaining.FullHealth)
        {
            repairButton.gameObject.SetActive(false);

        }
        else
        {
            repairButton.gameObject.SetActive(true);
            repairText.text = $"Repair (${Mathf.CeilToInt(weaponSaveData.healthRemaining.ToDamage * discount)})";

        }
    }

    public void RepairWeapon()
    {
        var roundUpDamage = Mathf.CeilToInt(weapon.healthRemaining.ToDamage * discount);
        var canRepair = CampaignMenu.Instance.UpdateMoney(roundUpDamage);
        if (canRepair)
        {
            weapon.healthRemaining.value = weapon.healthRemaining.initial;

            weaponName.text = weapon.weaponName;
            healthSlider.value = weapon.healthRemaining.ToPercent;
            healthText.text = $"{Mathf.CeilToInt(weapon.healthRemaining.value)}/{Mathf.CeilToInt(weapon.healthRemaining.initial)}";
            repairButton.gameObject.SetActive(false);

            shipUIUnit.CheckSubsystemsDamaged();
            CampaignMenu.Instance.SaveGame();
            CampaignMap.Instance.UpdateShip(ship);

        }
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
