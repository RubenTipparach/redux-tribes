using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class WeaponButtonTemplate : MonoBehaviour
{
    public Sprite Weapon_u;
    public Sprite Weapon_s;

    public Button button;

    public WeaponIcon weaponIcon;

    public Image weaponIconImage;

    public ShipController ship;
    public WeaponController weaponController;
    public InfoWeaponButton weaponButtonInfo;
    public void Initialize(WeaponIcon icon, WeaponController wc, ShipController sc){
        weaponIcon = icon;
        weaponController = wc;
        ship = sc;
        weaponButtonInfo.weaponController = this;

        SetButtonSelected(false);
        button.onClick.AddListener(AttackWithWeapon);
    }

    public void SetButtonSelected(bool selected)
    {
        if (selected)
        {
            weaponIconImage.sprite = weaponIcon.icon_u;
            button.image.sprite = Weapon_u;
        }
        else
        {
            weaponIconImage.sprite = weaponIcon.icon_s;
            button.image.sprite = Weapon_s;
        }
    }

    public void ToggleAttackWithWeapon()
    {
        if (GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating)
        {
            // to do logic: Dequeue attack.
            var second = Mathf.RoundToInt(GameManager.Instance.selectedTime);
            if (ship.CheckAndDequeueAttack(second, weaponController))
            {
                SetButtonSelected(false);
            }
            else
            {
                AttackWithWeapon();
            }
        }
    }

    public void AttackWithWeapon()
    {
        var second = Mathf.RoundToInt(GameManager.Instance.selectedTime);

        if (GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating)
        {
            ship.QueueWeaponAttack(second, weaponController);

            GameManager.Instance.uiManagerV2?.weaponsPanel
                .UpdateAttackQueueUI(GameManager.Instance.shipSelected.attackOrders);

            SetButtonSelected(true);
        }
    }

    public void DequeueWeapon(int second){
        ship.CheckAndDequeueAttack(second, weaponController);
        SetButtonSelected(false);
    }


}
